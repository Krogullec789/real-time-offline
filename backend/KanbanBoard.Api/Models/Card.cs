namespace KanbanBoard.Api.Models;

public class Card
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ColumnId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;

    /// <summary>0-based display order within the column.</summary>
    public int Order { get; set; }

    /// <summary>
    /// Used for last-write-wins conflict resolution.
    /// Every mutation must refresh this to DateTime.UtcNow before saving.
    /// </summary>
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Column Column { get; set; } = null!;
}
