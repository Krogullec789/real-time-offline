namespace KanbanBoard.Api.Services;

public static class CardPriorityValidator
{
    private static readonly HashSet<string> SupportedPriorities = new(StringComparer.OrdinalIgnoreCase)
    {
        "low",
        "medium",
        "high",
    };

    public static bool TryNormalize(string? priority, out string normalizedPriority)
    {
        normalizedPriority = string.IsNullOrWhiteSpace(priority)
            ? "medium"
            : priority.Trim().ToLowerInvariant();

        return SupportedPriorities.Contains(normalizedPriority);
    }

    public static string ErrorMessage => "Priority must be one of: low, medium, high.";
}
