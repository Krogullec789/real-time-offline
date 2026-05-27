using KanbanBoard.Api.Data;
using KanbanBoard.Api.DTOs;
using KanbanBoard.Api.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace KanbanBoard.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/[controller]")]
public class BoardsController(KanbanDbContext db, BoardAccessService boardAccess) : ControllerBase
{
    [HttpGet("{id:guid}")]
    public async Task<ActionResult<BoardDto>> GetBoard(Guid id)
    {
        if (!boardAccess.CanAccessBoard(User, id)) return Forbid();

        var board = await db.Boards
            .AsNoTracking()
            .Include(b => b.Columns.OrderBy(c => c.Order))
                .ThenInclude(c => c.Cards.OrderBy(card => card.Order))
            .FirstOrDefaultAsync(b => b.Id == id);

        return board is null ? NotFound() : Ok(MapBoard(board));
    }

    internal static BoardDto MapBoard(Models.Board board) => new(
        board.Id,
        board.Title,
        board.UpdatedAt,
        board.Columns.Select(MapColumn).ToArray());

    internal static ColumnDto MapColumn(Models.Column column) => new(
        column.Id,
        column.BoardId,
        column.Title,
        column.Order,
        column.UpdatedAt,
        column.Cards.Select(MapCard).ToArray());

    internal static CardDto MapCard(Models.Card card) => new(
        card.Id,
        card.ColumnId,
        card.Title,
        card.Description,
        card.Priority,
        card.Order,
        card.UpdatedAt);
}
