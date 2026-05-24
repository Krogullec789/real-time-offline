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
}
