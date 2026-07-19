require("dotenv/config");
const { PrismaClient } = require("@prisma/client");
const { PrismaMssql } = require("@prisma/adapter-mssql");
const argon2 = require("argon2");

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  const adapter = new PrismaMssql(connectionString);
  const prisma = new PrismaClient({ adapter });

  const username = process.env.SEED_ADMIN_USERNAME || "admin";
  const password = process.env.SEED_ADMIN_PASSWORD || "ChangeMe123!";

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    console.log(`Admin user "${username}" already exists (id=${existing.id}), skipping.`);
    return;
  }

  const passwordHash = await argon2.hash(password);
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash,
      role: "admin",
      displayName: "Administrator",
      isActive: true,
    },
  });

  console.log(`Created admin user "${user.username}" (id=${user.id}). Password: ${password}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit();
  });
