BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[Season] (
    [id] INT NOT NULL IDENTITY(1,1),
    [name] NVARCHAR(1000) NOT NULL,
    [roundType] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [Season_status_df] DEFAULT 'active',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Season_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Season_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[SeasonParticipant] (
    [id] INT NOT NULL IDENTITY(1,1),
    [seasonId] INT NOT NULL,
    [userId] INT NOT NULL,
    CONSTRAINT [SeasonParticipant_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [SeasonParticipant_seasonId_userId_key] UNIQUE NONCLUSTERED ([seasonId],[userId])
);

-- CreateTable
CREATE TABLE [dbo].[Match] (
    [id] INT NOT NULL IDENTITY(1,1),
    [seasonId] INT NOT NULL,
    [roundNumber] INT NOT NULL,
    [date] DATETIME2 NOT NULL,
    [player1Id] INT NOT NULL,
    [player2Id] INT NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [Match_status_df] DEFAULT 'scheduled',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Match_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Match_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- AddForeignKey
ALTER TABLE [dbo].[SeasonParticipant] ADD CONSTRAINT [SeasonParticipant_seasonId_fkey] FOREIGN KEY ([seasonId]) REFERENCES [dbo].[Season]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[SeasonParticipant] ADD CONSTRAINT [SeasonParticipant_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Match] ADD CONSTRAINT [Match_seasonId_fkey] FOREIGN KEY ([seasonId]) REFERENCES [dbo].[Season]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Match] ADD CONSTRAINT [Match_player1Id_fkey] FOREIGN KEY ([player1Id]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Match] ADD CONSTRAINT [Match_player2Id_fkey] FOREIGN KEY ([player2Id]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
