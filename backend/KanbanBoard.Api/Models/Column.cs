namespace KanbanBoard.Api.Models;

public class Column
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid BoardId { get; set; }
    public string Title { get; set; } = string.Empty;

    /// <summary>0-based display order within the board.</summary>
    public int Order { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Board Board { get; set; } = null!;
    public ICollection<Card> Cards { get; set; } = [];
}
