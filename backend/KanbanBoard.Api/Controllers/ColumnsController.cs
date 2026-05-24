using KanbanBoard.Api.Data;
using KanbanBoard.Api.DTOs;
using KanbanBoard.Api.Hubs;
using KanbanBoard.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace KanbanBoard.Api.Controllers;

[ApiController]
[Route("api/boards/{boardId:guid}/[controller]")]
public class ColumnsController(KanbanDbContext db, IHubContext<KanbanHub> hub) : ControllerBase
{
    [HttpPost]
    public async Task<ActionResult<ColumnDto>> Create(Guid boardId, CreateColumnRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Title)) return BadRequest("Column title is required.");

        var board = await db.Boards.FindAsync(boardId);
        if (board is null) return NotFound("Board not found.");

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

        var dto = BoardsController.MapColumn(column);
        await hub.Clients.Group($"board-{boardId}").SendAsync("ColumnCreated", dto);

        return Created($"/api/boards/{boardId}/columns/{column.Id}", dto);
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<ColumnDto>> Update(Guid boardId, Guid id, UpdateColumnRequest req)
    {
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

        var dto = BoardsController.MapColumn(column);
        await hub.Clients.Group($"board-{boardId}").SendAsync("ColumnUpdated", dto);

        return Ok(dto);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid boardId, Guid id)
    {
        var column = await db.Columns
            .Include(c => c.Board)
            .FirstOrDefaultAsync(c => c.Id == id && c.BoardId == boardId);

        if (column is null) return NotFound();

        column.Board.UpdatedAt = DateTime.UtcNow;
        db.Columns.Remove(column);
        await db.SaveChangesAsync();

        await hub.Clients.Group($"board-{boardId}").SendAsync("ColumnDeleted", id);

        return NoContent();
    }
}
