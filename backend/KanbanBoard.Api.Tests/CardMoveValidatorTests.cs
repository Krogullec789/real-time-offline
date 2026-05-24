using KanbanBoard.Api.Models;
using KanbanBoard.Api.Services;

namespace KanbanBoard.Api.Tests;

public class CardMoveValidatorTests
{
    [Fact]
    public void ValidateTargetColumn_AllowsMovingWithinTheSameBoard()
    {
        var boardId = Guid.NewGuid();
        var sourceColumn = new Column { Id = Guid.NewGuid(), BoardId = boardId, Title = "Todo" };
        var targetColumn = new Column { Id = Guid.NewGuid(), BoardId = boardId, Title = "Done" };

        var result = CardMoveValidator.ValidateTargetColumn(sourceColumn, targetColumn);

        Assert.True(result.IsValid);
        Assert.Null(result.ErrorMessage);
    }

    [Fact]
    public void ValidateTargetColumn_RejectsMovingToAnotherBoard()
    {
        var sourceColumn = new Column { Id = Guid.NewGuid(), BoardId = Guid.NewGuid(), Title = "Todo" };
        var targetColumn = new Column { Id = Guid.NewGuid(), BoardId = Guid.NewGuid(), Title = "Done" };

        var result = CardMoveValidator.ValidateTargetColumn(sourceColumn, targetColumn);

        Assert.False(result.IsValid);
        Assert.Equal("Target column belongs to a different board.", result.ErrorMessage);
    }
}
