FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

# Copy solution and project files
COPY ["backend/KanbanBoard.sln", "backend/"]
COPY ["backend/KanbanBoard.Api/KanbanBoard.Api.csproj", "backend/KanbanBoard.Api/"]
COPY ["backend/KanbanBoard.Api.Tests/KanbanBoard.Api.Tests.csproj", "backend/KanbanBoard.Api.Tests/"]

# Restore dependencies
RUN dotnet restore "backend/KanbanBoard.sln"

# Copy all files
COPY backend/ backend/

# Build project
WORKDIR /src/backend/KanbanBoard.Api
RUN dotnet build "KanbanBoard.Api.csproj" -c Release -o /app/build

# Publish project
FROM build AS publish
RUN dotnet publish "KanbanBoard.Api.csproj" -c Release -o /app/publish /p:UseAppHost=false

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS final
WORKDIR /app
COPY --from=publish /app/publish .
ENV ASPNETCORE_URLS=http://+:5212
EXPOSE 5212
ENTRYPOINT ["dotnet", "KanbanBoard.Api.dll"]
