using System.Security.Claims;

namespace KanbanBoard.Api.Security;

public sealed class BoardAccessService
{
    public bool CanAccessBoard(ClaimsPrincipal user, Guid boardId)
    {
        if (user.Identity?.IsAuthenticated != true) return false;

        var allowedBoardIds = user.FindAll(ApiKeyAuthenticationHandler.BoardClaimType)
            .Select(claim => claim.Value)
            .ToArray();

        return allowedBoardIds.Length == 0
            || allowedBoardIds.Contains(boardId.ToString(), StringComparer.OrdinalIgnoreCase);
    }
}
