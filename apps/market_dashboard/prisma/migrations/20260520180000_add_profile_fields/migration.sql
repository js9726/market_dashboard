-- AlterTable
ALTER TABLE "User"
    ADD COLUMN "username"             TEXT,
    ADD COLUMN "bio"                  VARCHAR(200),
    ADD COLUMN "dashboardTagline"     VARCHAR(60),
    ADD COLUMN "publicProfileEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
