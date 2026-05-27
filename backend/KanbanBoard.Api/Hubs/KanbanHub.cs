using KanbanBoard.Api.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace KanbanBoard.Api.Hubs;

[Authorize]
public class KanbanHub(BoardAccessService boardAccess) : Hub
{
    public Task JoinBoard(string boardId)
    {
        if (!Guid.TryParse(boardId, out var parsedBoardId)
            || !boardAccess.CanAccessBoard(Context.User!, parsedBoardId))
        {
            throw new HubException("Board access denied.");
        }

        return Groups.AddToGroupAsync(Context.ConnectionId, $"board-{boardId}");
    }

    public Task LeaveBoard(string boardId)
    {
        if (!Guid.TryParse(boardId, out var parsedBoardId)
            || !boardAccess.CanAccessBoard(Context.User!, parsedBoardId))
        {
            throw new HubException("Board access denied.");
        }

        return Groups.RemoveFromGroupAsync(Context.ConnectionId, $"board-{boardId}");
    }
}
