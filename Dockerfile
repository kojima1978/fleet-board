# syntax=docker/dockerfile:1.7
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS scanner-setup
WORKDIR /src/bridge
COPY nfc-bridge/FleetFlow.NfcBridge.csproj nfc-bridge/Program.cs ./
RUN dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:PublishTrimmed=false -o /payload
COPY nfc-bridge/install.ps1 nfc-bridge/launch.ps1 nfc-bridge/start-fleetflow.ps1 nfc-bridge/messages.ja.json /payload/
WORKDIR /src/setup
COPY nfc-setup/ ./
RUN dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -p:PublishTrimmed=false -p:PayloadDirectory=/payload -o /out

FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM deps AS development
COPY --from=scanner-setup /out/FleetFlow-Setup.exe /opt/fleetflow/scanner-setup/FleetFlow-Setup.exe
ENV NODE_ENV=development
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM deps AS builder
COPY . .
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm run db:generate && npm run build

FROM node:22-alpine AS production
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app
COPY --from=scanner-setup /out/FleetFlow-Setup.exe /opt/fleetflow/scanner-setup/FleetFlow-Setup.exe
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
