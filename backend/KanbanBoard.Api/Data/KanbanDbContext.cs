using KanbanBoard.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace KanbanBoard.Api.Data;

public class KanbanDbContext(DbContextOptions<KanbanDbContext> options) : DbContext(options)
{
    public DbSet<Board> Boards => Set<Board>();
    public DbSet<Column> Columns => Set<Column>();
    public DbSet<Card> Cards => Set<Card>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Board>(board =>
        {
            board.HasKey(x => x.Id);
            board.Property(x => x.Title).HasMaxLength(200).IsRequired();
        });

        modelBuilder.Entity<Column>(column =>
        {
            column.HasKey(x => x.Id);
            column.Property(x => x.Title).HasMaxLength(200).IsRequired();

            column.HasOne(x => x.Board)
                .WithMany(board => board.Columns)
                .HasForeignKey(x => x.BoardId)
                .OnDelete(DeleteBehavior.Cascade);

            column.HasIndex(x => x.BoardId);
        });

        modelBuilder.Entity<Card>(card =>
        {
            card.HasKey(x => x.Id);
            card.Property(x => x.Title).HasMaxLength(500).IsRequired();
            card.Property(x => x.Description).HasMaxLength(4000);

            card.HasOne(x => x.Column)
                .WithMany(column => column.Cards)
                .HasForeignKey(x => x.ColumnId)
                .OnDelete(DeleteBehavior.Cascade);

            card.HasIndex(x => x.ColumnId);
        });

        var boardId = Guid.Parse("00000000-0000-0000-0000-000000000001");
        var now = new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        modelBuilder.Entity<Board>().HasData(new Board
        {
            Id = boardId,
            Title = "Main Board",
            CreatedAt = now,
            UpdatedAt = now,
        });

        var backlogId = Guid.Parse("00000000-0000-0000-0000-000000000011");
        var inProgressId = Guid.Parse("00000000-0000-0000-0000-000000000012");
        var reviewId = Guid.Parse("00000000-0000-0000-0000-000000000013");
        var doneId = Guid.Parse("00000000-0000-0000-0000-000000000014");

        modelBuilder.Entity<Column>().HasData(
            new Column { Id = backlogId, BoardId = boardId, Title = "Backlog", Order = 0, CreatedAt = now, UpdatedAt = now },
            new Column { Id = inProgressId, BoardId = boardId, Title = "In Progress", Order = 1, CreatedAt = now, UpdatedAt = now },
            new Column { Id = reviewId, BoardId = boardId, Title = "Review", Order = 2, CreatedAt = now, UpdatedAt = now },
            new Column { Id = doneId, BoardId = boardId, Title = "Done", Order = 3, CreatedAt = now, UpdatedAt = now });

        modelBuilder.Entity<Card>().HasData(
            new Card { Id = Guid.Parse("00000000-0000-0000-0000-000000000021"), ColumnId = backlogId, Title = "Set up CI/CD pipeline", Order = 0, UpdatedAt = now },
            new Card { Id = Guid.Parse("00000000-0000-0000-0000-000000000022"), ColumnId = backlogId, Title = "Write API documentation", Order = 1, UpdatedAt = now },
            new Card { Id = Guid.Parse("00000000-0000-0000-0000-000000000023"), ColumnId = inProgressId, Title = "Implement SignalR hub", Order = 0, UpdatedAt = now },
            new Card { Id = Guid.Parse("00000000-0000-0000-0000-000000000024"), ColumnId = inProgressId, Title = "Build offline sync queue", Order = 1, UpdatedAt = now },
            new Card { Id = Guid.Parse("00000000-0000-0000-0000-000000000025"), ColumnId = reviewId, Title = "Design database schema", Order = 0, UpdatedAt = now },
            new Card { Id = Guid.Parse("00000000-0000-0000-0000-000000000026"), ColumnId = doneId, Title = "Project scaffolding", Order = 0, UpdatedAt = now });
    }
}
