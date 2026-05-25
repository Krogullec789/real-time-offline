using KanbanBoard.Api.Data;
using KanbanBoard.Api.DTOs;
using KanbanBoard.Api.Hubs;
using KanbanBoard.Api.Models;
using KanbanBoard.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace KanbanBoard.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class CardsController(KanbanDbContext db, IHubContext<KanbanHub> hub, ILogger<CardsController> logger) : ControllerBase
{
    [HttpPost]
    public async Task<ActionResult<CardDto>> Create(CreateCardRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Title)) return BadRequest("Card title is required.");

        var column = await db.Columns
            .Include(c => c.Board)
            .FirstOrDefaultAsync(c => c.Id == req.ColumnId);

        if (column is null) return NotFound("Column not found.");
        if (!CardPriorityValidator.TryNormalize(req.Priority, out var priority))
        {
            return BadRequest(CardPriorityValidator.ErrorMessage);
        }

        var maxOrder = await db.Cards
            .Where(c => c.ColumnId == req.ColumnId)
            .Select(c => (int?)c.Order)
            .MaxAsync() ?? -1;

        var now = DateTime.UtcNow;
        var card = new Card
        {
            Id = req.Id ?? Guid.NewGuid(),
            ColumnId = req.ColumnId,
            Title = req.Title.Trim(),
            Description = (req.Description ?? string.Empty).Trim(),
            Priority = priority,
            Order = maxOrder + 1,
            UpdatedAt = now,
        };

        logger.LogInformation("Creating card {CardId} in column {ColumnId} with title: '{Title}', priority: '{Priority}'", card.Id, card.ColumnId, card.Title, card.Priority);

        column.UpdatedAt = now;
        column.Board.UpdatedAt = now;
        db.Cards.Add(card);
        await db.SaveChangesAsync();

        var dto = BoardsController.MapCard(card);
        await hub.Clients.Group($"board-{column.BoardId}").SendAsync("CardCreated", dto);

        return CreatedAtAction(nameof(GetById), new { id = card.Id }, dto);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<CardDto>> GetById(Guid id)
    {
        var card = await db.Cards.AsNoTracking().FirstOrDefaultAsync(c => c.Id == id);
        return card is null ? NotFound() : Ok(BoardsController.MapCard(card));
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<CardDto>> Update(Guid id, UpdateCardRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Title)) return BadRequest("Card title is required.");

        var card = await db.Cards
            .Include(c => c.Column)
                .ThenInclude(c => c.Board)
            .FirstOrDefaultAsync(c => c.Id == id);

        if (card is null) return NotFound();
        if (!CardPriorityValidator.TryNormalize(req.Priority, out var priority))
        {
            return BadRequest(CardPriorityValidator.ErrorMessage);
        }

        if (req.ClientUpdatedAt < card.UpdatedAt)
        {
            logger.LogWarning("Conflict updating card {CardId}: client version ({ClientTime}) is older than server version ({ServerTime})", id, req.ClientUpdatedAt, card.UpdatedAt);
            return Conflict(new
            {
                message = "Conflict: server has a newer version.",
                serverCard = BoardsController.MapCard(card),
            });
        }

        var targetColumn = card.ColumnId == req.ColumnId
            ? card.Column
            : await db.Columns.Include(c => c.Board).FirstOrDefaultAsync(c => c.Id == req.ColumnId);

        if (targetColumn is null) return BadRequest("Target column not found.");

        var moveValidation = CardMoveValidator.ValidateTargetColumn(card.Column, targetColumn);
        if (!moveValidation.IsValid) return BadRequest(moveValidation.ErrorMessage);

        var now = DateTime.UtcNow;
        card.Title = req.Title.Trim();
        card.Description = (req.Description ?? string.Empty).Trim();
        card.Priority = priority;
        card.Order = req.Order;
        card.ColumnId = req.ColumnId;
        card.UpdatedAt = now;
        card.Column.UpdatedAt = now;
        targetColumn.UpdatedAt = now;
        targetColumn.Board.UpdatedAt = now;

        logger.LogInformation("Updated card {CardId}: title='{Title}', priority='{Priority}', columnId={ColumnId}", card.Id, card.Title, card.Priority, card.ColumnId);

        await db.SaveChangesAsync();

        var dto = BoardsController.MapCard(card);
        await hub.Clients.Group($"board-{targetColumn.BoardId}").SendAsync("CardUpdated", dto);

        return Ok(dto);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var card = await db.Cards
            .Include(c => c.Column)
                .ThenInclude(c => c.Board)
            .FirstOrDefaultAsync(c => c.Id == id);

        if (card is null) return NotFound();

        var boardId = card.Column.BoardId;
        var now = DateTime.UtcNow;
        card.Column.UpdatedAt = now;
        card.Column.Board.UpdatedAt = now;
        
        logger.LogInformation("Deleting card {CardId} from column {ColumnId} on board {BoardId}", card.Id, card.ColumnId, boardId);

        db.Cards.Remove(card);
        await db.SaveChangesAsync();

        await hub.Clients.Group($"board-{boardId}").SendAsync("CardDeleted", id);

        return NoContent();
    }

    [HttpPut("batch-move")]
    public async Task<IActionResult> BatchMove(BatchMoveRequest req)
    {
        var requestedPositions = req.Cards.ToArray();
        if (requestedPositions.Length == 0) return BadRequest("Empty batch.");

        var ids = requestedPositions.Select(p => p.Id).ToHashSet();
        var cards = await db.Cards
            .Include(c => c.Column)
                .ThenInclude(c => c.Board)
            .Where(c => ids.Contains(c.Id))
            .ToDictionaryAsync(c => c.Id);

        if (cards.Count != ids.Count) return NotFound("One or more cards not found.");

        var sourceBoardIds = cards.Values.Select(c => c.Column.BoardId).Distinct().ToArray();
        if (sourceBoardIds.Length != 1) return BadRequest("Batch moves cannot span multiple boards.");

        var boardId = sourceBoardIds[0];
        var targetColumnIds = requestedPositions.Select(p => p.ColumnId).ToHashSet();
        var targetColumns = await db.Columns
            .Include(c => c.Board)
            .Where(c => targetColumnIds.Contains(c.Id))
            .ToDictionaryAsync(c => c.Id);

        if (targetColumns.Count != targetColumnIds.Count) return BadRequest("One or more target columns were not found.");

        if (targetColumns.Values.Any(column => column.BoardId != boardId))
        {
            return BadRequest("Target columns must belong to the same board as the moved cards.");
        }

        var now = DateTime.UtcNow;
        logger.LogInformation("Batch moving {Count} cards on board {BoardId}", requestedPositions.Length, boardId);

        var conflictedCards = requestedPositions
            .Where(position => position.ClientUpdatedAt < cards[position.Id].UpdatedAt)
            .Select(position => BoardsController.MapCard(cards[position.Id]))
            .ToArray();

        if (conflictedCards.Length > 0)
        {
            logger.LogWarning("Conflict in batch move on board {BoardId}: {Count} cards have newer server versions.", boardId, conflictedCards.Length);
            return Conflict(new
            {
                message = "Conflict: one or more cards have newer server versions.",
                serverCards = conflictedCards,
            });
        }

        foreach (var position in requestedPositions)
        {
            var card = cards[position.Id];
            card.ColumnId = position.ColumnId;
            card.Order = position.Order;
            card.UpdatedAt = now;
            targetColumns[position.ColumnId].UpdatedAt = now;
        }

        foreach (var board in targetColumns.Values.Select(c => c.Board).DistinctBy(b => b.Id))
        {
            board.UpdatedAt = now;
        }

        await db.SaveChangesAsync();

        var dtos = cards.Values
            .OrderBy(card => card.ColumnId)
            .ThenBy(card => card.Order)
            .Select(BoardsController.MapCard)
            .ToArray();

        await hub.Clients.Group($"board-{boardId}").SendAsync("CardsBatchMoved", dtos);

        return Ok(dtos);
    }
}
