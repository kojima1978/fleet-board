ALTER TABLE "Employee" ADD COLUMN "email" TEXT;

CREATE UNIQUE INDEX "Employee_email_key" ON "Employee"("email");
