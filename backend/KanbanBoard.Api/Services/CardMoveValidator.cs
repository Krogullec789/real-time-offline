using KanbanBoard.Api.Models;

namespace KanbanBoard.Api.Services;

public sealed record CardMoveValidationResult(bool IsValid, string? ErrorMessage)
{
    public static CardMoveValidationResult Success { get; } = new(true, null);
}

public static class CardMoveValidator
{
    public static CardMoveValidationResult ValidateTargetColumn(Column sourceColumn, Column targetColumn)
    {
        return sourceColumn.BoardId == targetColumn.BoardId
            ? CardMoveValidationResult.Success
            : new CardMoveValidationResult(false, "Target column belongs to a different board.");
    }
}
