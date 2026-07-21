BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[Leg] (
    [id] INT NOT NULL IDENTITY(1,1),
    [matchId] INT NOT NULL,
    [legNumber] INT NOT NULL,
    [startingPlayerId] INT NOT NULL,
    [winnerPlayerId] INT,
    [checkoutValue] INT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Leg_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Leg_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Leg_matchId_legNumber_key] UNIQUE NONCLUSTERED ([matchId],[legNumber])
);

-- CreateTable
CREATE TABLE [dbo].[Throw] (
    [id] INT NOT NULL IDENTITY(1,1),
    [legId] INT NOT NULL,
    [playerId] INT NOT NULL,
    [turnNumber] INT NOT NULL,
    [dartNumber] INT NOT NULL,
    [multiplier] NVARCHAR(1000) NOT NULL,
    [segment] INT NOT NULL,
    [value] INT NOT NULL,
    [busted] BIT NOT NULL CONSTRAINT [Throw_busted_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Throw_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Throw_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- AddForeignKey
ALTER TABLE [dbo].[Leg] ADD CONSTRAINT [Leg_matchId_fkey] FOREIGN KEY ([matchId]) REFERENCES [dbo].[Match]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Leg] ADD CONSTRAINT [Leg_startingPlayerId_fkey] FOREIGN KEY ([startingPlayerId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Leg] ADD CONSTRAINT [Leg_winnerPlayerId_fkey] FOREIGN KEY ([winnerPlayerId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Throw] ADD CONSTRAINT [Throw_legId_fkey] FOREIGN KEY ([legId]) REFERENCES [dbo].[Leg]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Throw] ADD CONSTRAINT [Throw_playerId_fkey] FOREIGN KEY ([playerId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
