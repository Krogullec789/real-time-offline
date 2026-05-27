using KanbanBoard.Api.Data;
using KanbanBoard.Api.DTOs;
using KanbanBoard.Api.Hubs;
using KanbanBoard.Api.Models;
using KanbanBoard.Api.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace KanbanBoard.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/boards/{boardId:guid}/[controller]")]
public class ColumnsController(
    KanbanDbContext db,
    IHubContext<KanbanHub> hub,
    ILogger<ColumnsController> logger,
    BoardAccessService boardAccess) : ControllerBase
{
    [HttpPost]
    public async Task<ActionResult<ColumnDto>> Create(Guid boardId, CreateColumnRequest req)
    {
        if (!boardAccess.CanAccessBoard(User, boardId)) return Forbid();
        if (string.IsNullOrWhiteSpace(req.Title)) return BadRequest("Column title is required.");

        var board = await db.Boards.FindAsync(boardId);
        if (board is null) return NotFound("Board not found.");

        if (req.Id is Guid requestedId)
        {
            var existing = await db.Columns
                .Include(c => c.Cards.OrderBy(card => card.Order))
                .AsNoTracking()
                .FirstOrDefaultAsync(c => c.Id == requestedId && c.BoardId == boardId);

            if (existing is not null)
            {
                return Ok(BoardsController.MapColumn(existing));
            }
        }

        var maxOrder = await db.Columns
            .Where(c => c.BoardId == boardId)
            .Select(c => (int?)c.Order)
            .MaxAsync() ?? -1;

        var now = DateTime.UtcNow;
        var column = new Column
        {
            Id = req.Id ?? Guid.NewGuid(),
            BoardId = boardId,
            Title = req.Title.Trim(),
            Order = maxOrder + 1,
            CreatedAt = now,
            UpdatedAt = now,
        };

        board.UpdatedAt = now;
        db.Columns.Add(column);
        await db.SaveChangesAsync();

        logger.LogInformation("Created column {ColumnId} in board {BoardId} with title: '{Title}'", column.Id, boardId, column.Title);

        var dto = BoardsController.MapColumn(column);
        await hub.Clients.Group($"board-{boardId}").SendAsync("ColumnCreated", dto);

        return Created($"/api/boards/{boardId}/columns/{column.Id}", dto);
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<ColumnDto>> Update(Guid boardId, Guid id, UpdateColumnRequest req)
    {
        if (!boardAccess.CanAccessBoard(User, boardId)) return Forbid();
        if (string.IsNullOrWhiteSpace(req.Title)) return BadRequest("Column title is required.");

        var column = await db.Columns
            .Include(c => c.Board)
            .Include(c => c.Cards.OrderBy(card => card.Order))
            .FirstOrDefaultAsync(c => c.Id == id && c.BoardId == boardId);

        if (column is null) return NotFound();

        var now = DateTime.UtcNow;
        column.Title = req.Title.Trim();
        column.Order = req.Order;
        column.UpdatedAt = now;
        column.Board.UpdatedAt = now;

        await db.SaveChangesAsync();

        logger.LogInformation("Updated column {ColumnId} in board {BoardId}: title='{Title}', order={Order}", id, boardId, column.Title, column.Order);

        var dto = BoardsController.MapColumn(column);
        await hub.Clients.Group($"board-{boardId}").SendAsync("ColumnUpdated", dto);

        return Ok(dto);
    }

    [HttpPut("batch-move")]
    public async Task<ActionResult<IEnumerable<ColumnDto>>> BatchMove(Guid boardId, BatchMoveColumnsRequest req)
    {
        if (!boardAccess.CanAccessBoard(User, boardId)) return Forbid();
        var requestedPositions = req.Columns.ToArray();
        if (requestedPositions.Length == 0) return BadRequest("Empty batch.");

        var duplicatedIds = requestedPositions
            .GroupBy(position => position.Id)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .ToArray();
        if (duplicatedIds.Length > 0) return BadRequest("Column ids must be unique.");

        var duplicatedOrders = requestedPositions
            .GroupBy(position => position.Order)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .ToArray();
        if (duplicatedOrders.Length > 0) return BadRequest("Column orders must be unique.");

        var orderedPositions = requestedPositions.OrderBy(position => position.Order).ToArray();
        if (orderedPositions.Where((position, index) => position.Order != index).Any())
        {
            return BadRequest("Column orders must be contiguous and start at 0.");
        }

        var ids = requestedPositions.Select(position => position.Id).ToHashSet();
        var columns = await db.Columns
            .Include(column => column.Board)
            .Include(column => column.Cards.OrderBy(card => card.Order))
            .Where(column => column.BoardId == boardId && ids.Contains(column.Id))
            .ToDictionaryAsync(column => column.Id);

        if (columns.Count != ids.Count) return NotFound("One or more columns not found.");

        var boardColumnCount = await db.Columns.CountAsync(column => column.BoardId == boardId);
        if (requestedPositions.Length != boardColumnCount)
        {
            return BadRequest("Column reorder must include every column on the board.");
        }

        var now = DateTime.UtcNow;
        foreach (var position in requestedPositions)
        {
            var column = columns[position.Id];
            column.Order = position.Order;
            column.UpdatedAt = now;
        }

        foreach (var board in columns.Values.Select(column => column.Board).DistinctBy(board => board.Id))
        {
            board.UpdatedAt = now;
        }

        await db.SaveChangesAsync();

        var dtos = columns.Values
            .OrderBy(column => column.Order)
            .Select(BoardsController.MapColumn)
            .ToArray();

        logger.LogInformation("Batch reordered {Count} columns in board {BoardId}", dtos.Length, boardId);
        await hub.Clients.Group($"board-{boardId}").SendAsync("ColumnsBatchMoved", dtos);

        return Ok(dtos);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid boardId, Guid id)
    {
        if (!boardAccess.CanAccessBoard(User, boardId)) return Forbid();
        var column = await db.Columns
            .Include(c => c.Board)
            .FirstOrDefaultAsync(c => c.Id == id && c.BoardId == boardId);

        if (column is null) return NoContent();

        column.Board.UpdatedAt = DateTime.UtcNow;
        db.Columns.Remove(column);
        await db.SaveChangesAsync();

        logger.LogInformation("Deleted column {ColumnId} in board {BoardId}", id, boardId);

        await hub.Clients.Group($"board-{boardId}").SendAsync("ColumnDeleted", id);

        return NoContent();
    }
}
