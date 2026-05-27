using System.Net;
using System.Net.Http.Json;
using KanbanBoard.Api.Data;
using KanbanBoard.Api.DTOs;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace KanbanBoard.Api.Tests;

public class BatchMoveEndpointTests
{
    [Fact]
    public async Task BatchMove_MovesCardToAnotherColumnThroughHttpEndpoint()
    {
        await using var factory = new KanbanApiFactory();
        using var client = factory.CreateClient();

        var cardId = Guid.Parse("00000000-0000-0000-0000-000000000021");
        var targetColumnId = Guid.Parse("00000000-0000-0000-0000-000000000012");

        var payload = new BatchMoveRequest([
            new CardPositionDto(cardId, targetColumnId, 2, DateTime.UtcNow)
        ]);

        var response = await client.PutAsJsonAsync("/api/cards/batch-move", payload);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<KanbanDbContext>();
        var movedCard = await db.Cards.AsNoTracking().SingleAsync(card => card.Id == cardId);

        Assert.Equal(targetColumnId, movedCard.ColumnId);
        Assert.Equal(2, movedCard.Order);
    }

    [Fact]
    public async Task CreateCard_RejectsUnsupportedPriority()
    {
        await using var factory = new KanbanApiFactory();
        using var client = factory.CreateClient();

        var columnId = Guid.Parse("00000000-0000-0000-0000-000000000011");

        var response = await client.PostAsJsonAsync("/api/cards", new CreateCardRequest(
            Id: null,
            ColumnId: columnId,
            Title: "Add professional validation",
            Description: "",
            Priority: "urgent"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CreateCard_WithSameClientIdAfterLostResponseReturnsExistingCard()
    {
        await using var factory = new KanbanApiFactory();
        using var client = factory.CreateClient();

        var columnId = Guid.Parse("00000000-0000-0000-0000-000000000011");
        var cardId = Guid.Parse("00000000-0000-0000-0000-000000000099");
        var request = new CreateCardRequest(
            Id: cardId,
            ColumnId: columnId,
            Title: "Idempotent offline create",
            Description: "",
            Priority: "medium");

        var firstResponse = await client.PostAsJsonAsync("/api/cards", request);
        var replayResponse = await client.PostAsJsonAsync("/api/cards", request);

        Assert.Equal(HttpStatusCode.Created, firstResponse.StatusCode);
        Assert.Equal(HttpStatusCode.OK, replayResponse.StatusCode);

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<KanbanDbContext>();
        var count = await db.Cards.CountAsync(card => card.Id == cardId);

        Assert.Equal(1, count);
    }

    [Fact]
    public async Task DeleteCard_ReturnsNoContentWhenCardWasAlreadyDeleted()
    {
        await using var factory = new KanbanApiFactory();
        using var client = factory.CreateClient();

        var response = await client.DeleteAsync("/api/cards/00000000-0000-0000-0000-000000000099");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    [Fact]
    public async Task BatchMove_ReturnsConflictAndLeavesCardsUnchangedWhenClientVersionIsStale()
    {
        await using var factory = new KanbanApiFactory();
        using var client = factory.CreateClient();

        var cardId = Guid.Parse("00000000-0000-0000-0000-000000000021");
        var targetColumnId = Guid.Parse("00000000-0000-0000-0000-000000000012");
        var serverUpdatedAt = DateTime.UtcNow.AddMinutes(5);
        var staleClientUpdatedAt = serverUpdatedAt.AddMinutes(-1);

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<KanbanDbContext>();
            var card = await db.Cards.SingleAsync(card => card.Id == cardId);
            card.UpdatedAt = serverUpdatedAt;
            await db.SaveChangesAsync();
        }

        var payload = new BatchMoveRequest([
            new CardPositionDto(cardId, targetColumnId, 2, staleClientUpdatedAt)
        ]);

        var response = await client.PutAsJsonAsync("/api/cards/batch-move", payload);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);

        using var verificationScope = factory.Services.CreateScope();
        var verificationDb = verificationScope.ServiceProvider.GetRequiredService<KanbanDbContext>();
        var unchangedCard = await verificationDb.Cards.AsNoTracking().SingleAsync(card => card.Id == cardId);

        Assert.Equal(Guid.Parse("00000000-0000-0000-0000-000000000011"), unchangedCard.ColumnId);
        Assert.Equal(0, unchangedCard.Order);
    }

    [Fact]
    public async Task BatchMove_RejectsRequestsWithoutCardsCollection()
    {
        await using var factory = new KanbanApiFactory();
        using var client = factory.CreateClient();

        var response = await client.PutAsJsonAsync("/api/cards/batch-move", new { });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task BatchMoveColumns_ReordersAllColumnsAtomically()
    {
        await using var factory = new KanbanApiFactory();
        using var client = factory.CreateClient();

        var boardId = Guid.Parse("00000000-0000-0000-0000-000000000001");
        var response = await client.PutAsJsonAsync($"/api/boards/{boardId}/columns/batch-move", new BatchMoveColumnsRequest([
            new ColumnPositionDto(Guid.Parse("00000000-0000-0000-0000-000000000014"), 0),
            new ColumnPositionDto(Guid.Parse("00000000-0000-0000-0000-000000000011"), 1),
            new ColumnPositionDto(Guid.Parse("00000000-0000-0000-0000-000000000012"), 2),
            new ColumnPositionDto(Guid.Parse("00000000-0000-0000-0000-000000000013"), 3),
        ]));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<KanbanDbContext>();
        var orders = await db.Columns
            .AsNoTracking()
            .Where(column => column.BoardId == boardId)
            .OrderBy(column => column.Order)
            .Select(column => column.Id)
            .ToArrayAsync();

        Assert.Equal(Guid.Parse("00000000-0000-0000-0000-000000000014"), orders[0]);
        Assert.Equal(Guid.Parse("00000000-0000-0000-0000-000000000011"), orders[1]);
    }

    [Fact]
    public async Task BatchMoveColumns_RejectsDuplicateOrders()
    {
        await using var factory = new KanbanApiFactory();
        using var client = factory.CreateClient();

        var boardId = Guid.Parse("00000000-0000-0000-0000-000000000001");
        var response = await client.PutAsJsonAsync($"/api/boards/{boardId}/columns/batch-move", new BatchMoveColumnsRequest([
            new ColumnPositionDto(Guid.Parse("00000000-0000-0000-0000-000000000011"), 0),
            new ColumnPositionDto(Guid.Parse("00000000-0000-0000-0000-000000000012"), 0),
        ]));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}

public sealed class KanbanApiFactory : WebApplicationFactory<Program>
{
    private readonly InMemoryDatabaseRoot databaseRoot = new();
    private readonly string databaseName = $"kanban-tests-{Guid.NewGuid()}";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration(configuration =>
        {
            configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = "Host=localhost;Database=kanban_test;Username=test;Password=test",
                ["Auth:ApiKey"] = "test-api-key",
                ["Auth:AllowedBoardIds:0"] = "00000000-0000-0000-0000-000000000001",
            });
        });

        builder.ConfigureServices(services =>
        {
            services.RemoveAll<DbContextOptions<KanbanDbContext>>();
            services.AddDbContext<KanbanDbContext>(options =>
                options.UseInMemoryDatabase(databaseName, databaseRoot));

            using var provider = services.BuildServiceProvider();
            using var scope = provider.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<KanbanDbContext>();
            db.Database.EnsureDeleted();
            db.Database.EnsureCreated();
        });
    }

    protected override void ConfigureClient(HttpClient client)
    {
        client.DefaultRequestHeaders.Add("X-API-Key", "test-api-key");
    }
}
