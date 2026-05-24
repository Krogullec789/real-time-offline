using Microsoft.AspNetCore.SignalR;

namespace KanbanBoard.Api.Hubs;

public class KanbanHub : Hub
{
    public Task JoinBoard(string boardId)
    {
        return Groups.AddToGroupAsync(Context.ConnectionId, $"board-{boardId}");
    }

    public Task LeaveBoard(string boardId)
    {
        return Groups.RemoveFromGroupAsync(Context.ConnectionId, $"board-{boardId}");
    }
}
