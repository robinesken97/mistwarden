-- Mistwarden (2026-11-24): a new instance starts with the Mistwarden name, theme
-- and font. Defaults only; an instance's stored choices are left as they are.
ALTER TABLE "SystemSettings" ALTER COLUMN "instanceName" SET DEFAULT 'Mistwarden';
ALTER TABLE "SystemSettings" ALTER COLUMN "themeId" SET DEFAULT 'mistwarden';
ALTER TABLE "SystemSettings" ALTER COLUMN "fontId" SET DEFAULT 'mistwarden';
