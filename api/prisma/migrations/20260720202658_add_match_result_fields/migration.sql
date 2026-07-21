BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Match] ADD [player1Checkout] INT,
[player1Legs] INT,
[player2Checkout] INT,
[player2Legs] INT,
[resultEnteredAt] DATETIME2,
[resultEnteredById] INT;

-- AddForeignKey
ALTER TABLE [dbo].[Match] ADD CONSTRAINT [Match_resultEnteredById_fkey] FOREIGN KEY ([resultEnteredById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
