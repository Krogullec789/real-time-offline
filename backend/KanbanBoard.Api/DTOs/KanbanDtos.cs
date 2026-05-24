using System.ComponentModel.DataAnnotations;

namespace KanbanBoard.Api.DTOs;

public record BoardDto(Guid Id, string Title, DateTime UpdatedAt, IEnumerable<ColumnDto> Columns);

public record ColumnDto(Guid Id, Guid BoardId, string Title, int Order, DateTime UpdatedAt, IEnumerable<CardDto> Cards);

public record CreateColumnRequest(
    Guid? Id,
    [property: Required, StringLength(200, MinimumLength = 1)] string Title);

public record UpdateColumnRequest(
    [property: Required, StringLength(200, MinimumLength = 1)] string Title,
    [property: Range(0, int.MaxValue)] int Order);

public record CardDto(Guid Id, Guid ColumnId, string Title, string Description, int Order, DateTime UpdatedAt);

public record CreateCardRequest(
    Guid? Id,
    Guid ColumnId,
    [property: Required, StringLength(500, MinimumLength = 1)] string Title,
    [property: StringLength(4000)] string Description = "");

public record UpdateCardRequest(
    [property: Required, StringLength(500, MinimumLength = 1)] string Title,
    [property: StringLength(4000)] string Description,
    [property: Range(0, int.MaxValue)] int Order,
    Guid ColumnId,
    DateTime ClientUpdatedAt);

public record BatchMoveRequest(IEnumerable<CardPositionDto> Cards);

public record CardPositionDto(
    Guid Id,
    Guid ColumnId,
    [property: Range(0, int.MaxValue)] int Order,
    DateTime ClientUpdatedAt);
