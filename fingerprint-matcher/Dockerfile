FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src
COPY SourceAfisMatcher.csproj .
RUN dotnet restore
COPY Program.cs .
RUN dotnet publish -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:9.0
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app .
ENV ASPNETCORE_URLS=http://0.0.0.0:9100
EXPOSE 9100
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=6 CMD curl --fail --silent http://127.0.0.1:9100/health || exit 1
ENTRYPOINT ["dotnet", "SourceAfisMatcher.dll"]
