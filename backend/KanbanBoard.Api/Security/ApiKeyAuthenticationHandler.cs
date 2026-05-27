using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace KanbanBoard.Api.Security;

public sealed class ApiKeyAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    IConfiguration configuration)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "ApiKey";
    public const string HeaderName = "X-API-Key";
    public const string BoardClaimType = "board";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var expectedApiKey = configuration["Auth:ApiKey"];
        if (string.IsNullOrWhiteSpace(expectedApiKey))
        {
            return Task.FromResult(AuthenticateResult.Fail("API key authentication is not configured."));
        }

        var authorizationHeader = Request.Headers.Authorization.FirstOrDefault();
        var bearerToken = authorizationHeader?.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) == true
            ? authorizationHeader["Bearer ".Length..].Trim()
            : null;
        var providedApiKey = Request.Headers[HeaderName].FirstOrDefault()
            ?? Request.Query["access_token"].FirstOrDefault()
            ?? bearerToken;

        if (!string.Equals(providedApiKey, expectedApiKey, StringComparison.Ordinal))
        {
            return Task.FromResult(AuthenticateResult.Fail("Invalid API key."));
        }

        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, "demo-user"),
            new(ClaimTypes.Name, "Demo User"),
        };

        var allowedBoardIds = configuration.GetSection("Auth:AllowedBoardIds").Get<string[]>() ?? [];
        claims.AddRange(allowedBoardIds.Select(boardId => new Claim(BoardClaimType, boardId)));

        var identity = new ClaimsIdentity(claims, SchemeName);
        var principal = new ClaimsPrincipal(identity);
        var ticket = new AuthenticationTicket(principal, SchemeName);

        return Task.FromResult(AuthenticateResult.Success(ticket));
    }
}
