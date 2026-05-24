using KanbanBoard.Api.Data;
using KanbanBoard.Api.Hubs;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

if (!builder.Environment.IsEnvironment("Testing"))
{
    var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");
    if (string.IsNullOrWhiteSpace(connectionString))
    {
        throw new InvalidOperationException("Connection string 'DefaultConnection' is not configured.");
    }

    builder.Services.AddDbContext<KanbanDbContext>(options =>
        options.UseNpgsql(connectionString));
}

builder.Services.AddSignalR();

var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
    ?? ["http://localhost:5173"];

builder.Services.AddCors(options => options.AddPolicy("ClientApp", policy =>
    policy
        .WithOrigins(allowedOrigins)
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials()));

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();

    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<KanbanDbContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
    
    int retries = 5;
    while (retries > 0)
    {
        try
        {
            logger.LogInformation("Applying EF Core migrations...");
            await db.Database.MigrateAsync();
            logger.LogInformation("Migrations applied successfully.");
            break;
        }
        catch (Exception ex)
        {
            retries--;
            logger.LogWarning(ex, "Failed to apply migrations. Retrying in 5 seconds... ({Retries} left)", retries);
            if (retries == 0)
            {
                logger.LogError(ex, "Could not apply database migrations. Exiting.");
                throw;
            }
            await Task.Delay(5000);
        }
    }
}

app.UseRouting();
app.UseCors("ClientApp");
app.UseAuthorization();

app.MapControllers();
app.MapHub<KanbanHub>("/hubs/kanban");

app.Run();

public partial class Program;
