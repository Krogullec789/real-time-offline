using System.ComponentModel.DataAnnotations;

namespace KanbanBoard.Api.DTOs;

public record BoardDto(Guid Id, string Title, DateTime UpdatedAt, IEnumerable<ColumnDto> Columns);

public record ColumnDto(Guid Id, Guid BoardId, string Title, int Order, DateTime UpdatedAt, IEnumerable<CardDto> Cards);

public record CreateColumnRequest(
    Guid? Id,
    [param: Required, StringLength(200, MinimumLength = 1)] string Title);

public record UpdateColumnRequest(
    [param: Required, StringLength(200, MinimumLength = 1)] string Title,
    [param: Range(0, int.MaxValue)] int Order);

public record CardDto(Guid Id, Guid ColumnId, string Title, string Description, string Priority, int Order, DateTime UpdatedAt);

public record CreateCardRequest(
    Guid? Id,
    Guid ColumnId,
    [param: Required, StringLength(500, MinimumLength = 1)] string Title,
    [param: StringLength(4000)] string Description = "",
    [param: StringLength(50)] string Priority = "medium");

public record UpdateCardRequest(
    [param: Required, StringLength(500, MinimumLength = 1)] string Title,
    [param: StringLength(4000)] string Description,
    [param: StringLength(50)] string Priority,
    [param: Range(0, int.MaxValue)] int Order,
    Guid ColumnId,
    DateTime ClientUpdatedAt);

public record BatchMoveRequest(IEnumerable<CardPositionDto> Cards);

public record CardPositionDto(
    Guid Id,
    Guid ColumnId,
    [param: Range(0, int.MaxValue)] int Order,
    DateTime ClientUpdatedAt);
