-- AlterTable
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" DATETIME;

-- CreateTable
CREATE TABLE "EmailSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "installationId" TEXT NOT NULL,
    "smtpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT false,
    "smtpUsername" TEXT,
    "smtpFromEmail" TEXT,
    "smtpFromName" TEXT,
    "smtpVerifiedAt" DATETIME,
    "emailNotificationMask" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EmailSettings_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "subjectTemplate" TEXT NOT NULL,
    "htmlTemplate" TEXT NOT NULL,
    "textTemplate" TEXT,
    "schemaJson" TEXT NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TotpRecoveryCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "salt" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" DATETIME,
    "invalidatedAt" DATETIME,
    CONSTRAINT "TotpRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "ip" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SignupInviteToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "invitedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "invalidatedAt" DATETIME,
    "revokedAt" DATETIME,
    "usedAt" DATETIME,
    "ip" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "SignupInviteToken_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuthMagicLinkToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "ip" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "AuthMagicLinkToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuthEmailOtpToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "salt" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "ip" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "AuthEmailOtpToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailSettings_installationId_key" ON "EmailSettings"("installationId");

-- CreateIndex
CREATE INDEX "EmailSettings_updatedAt_idx" ON "EmailSettings"("updatedAt");

-- CreateIndex
CREATE INDEX "EmailTemplate_key_idx" ON "EmailTemplate"("key");

-- CreateIndex
CREATE INDEX "EmailTemplate_updatedAt_idx" ON "EmailTemplate"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplate_key_locale_key" ON "EmailTemplate"("key", "locale");

-- CreateIndex
CREATE INDEX "TotpRecoveryCode_userId_createdAt_idx" ON "TotpRecoveryCode"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TotpRecoveryCode_userId_usedAt_invalidatedAt_idx" ON "TotpRecoveryCode"("userId", "usedAt", "invalidatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_expiresAt_idx" ON "EmailVerificationToken"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_expiresAt_idx" ON "EmailVerificationToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SignupInviteToken_tokenHash_key" ON "SignupInviteToken"("tokenHash");

-- CreateIndex
CREATE INDEX "SignupInviteToken_email_expiresAt_idx" ON "SignupInviteToken"("email", "expiresAt");

-- CreateIndex
CREATE INDEX "SignupInviteToken_expiresAt_idx" ON "SignupInviteToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthMagicLinkToken_tokenHash_key" ON "AuthMagicLinkToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthMagicLinkToken_userId_expiresAt_idx" ON "AuthMagicLinkToken"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "AuthMagicLinkToken_expiresAt_idx" ON "AuthMagicLinkToken"("expiresAt");

-- CreateIndex
CREATE INDEX "AuthEmailOtpToken_userId_expiresAt_idx" ON "AuthEmailOtpToken"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "AuthEmailOtpToken_expiresAt_idx" ON "AuthEmailOtpToken"("expiresAt");

-- Backfill EmailSettings from legacy Installation SMTP fields (if present).
-- NOTE: Use INSERT OR IGNORE to avoid overwriting existing settings in upgraded instances.
INSERT OR IGNORE INTO "EmailSettings" (
  "id",
  "installationId",
  "smtpEnabled",
  "smtpHost",
  "smtpPort",
  "smtpSecure",
  "smtpUsername",
  "smtpFromEmail",
  "smtpFromName",
  "smtpVerifiedAt",
  "emailNotificationMask",
  "createdAt",
  "updatedAt"
)
SELECT
  'email_settings',
  "id",
  COALESCE("smtpEnabled", false),
  "smtpHost",
  "smtpPort",
  COALESCE("smtpSecure", false),
  "smtpUsername",
  "smtpFromEmail",
  "smtpFromName",
  NULL,
  0,
  COALESCE("createdAt", CURRENT_TIMESTAMP),
  COALESCE("updatedAt", CURRENT_TIMESTAMP)
FROM "Installation"
WHERE "id" = 'installation';

-- Seed default templates (en + zh-cn).
-- These are the "factory defaults" and provide the always-available fallback content.
-- NOTE: Use INSERT OR IGNORE to avoid overwriting user-customized templates.
INSERT OR IGNORE INTO "EmailTemplate" (
  "id",
  "key",
  "locale",
  "subjectTemplate",
  "htmlTemplate",
  "textTemplate",
  "schemaJson",
  "version",
  "createdAt",
  "updatedAt"
) VALUES
  (
    'email_template:PASSWORD_RESET:en',
    'PASSWORD_RESET',
    'en',
    'Reset your {{appName}} password',
    '<h2>Reset your password</h2>
<p>We received a request to reset the password for your {{appName}} account ({{email}}).</p>
<p><a href="{{resetUrl}}">Reset your password</a></p>
<p>This link expires in {{expiresIn}}.</p>
<p>If you didn''t request this, you can safely ignore this email.</p>
',
    NULL,
    '{"vars":["appName","email","resetUrl","expiresIn"],"example":{"appName":"Maia","email":"user@example.com","resetUrl":"https://example.com/reset-password?token=...","expiresIn":"1 hour"}}',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'email_template:PASSWORD_RESET:zh-cn',
    'PASSWORD_RESET',
    'zh-cn',
    '重置你的 {{appName}} 密码',
    '<h2>重置密码</h2>
<p>我们收到为你的 {{appName}} 账号（{{email}}）重置密码的请求。</p>
<p><a href="{{resetUrl}}">点击这里重置密码</a></p>
<p>该链接将在 {{expiresIn}} 后过期。</p>
<p>如果这不是你发起的请求，请忽略此邮件。</p>
',
    NULL,
    '{"vars":["appName","email","resetUrl","expiresIn"],"example":{"appName":"Maia","email":"user@example.com","resetUrl":"https://example.com/reset-password?token=...","expiresIn":"1 hour"}}',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'email_template:SYSTEM_SMTP_TEST:en',
    'SYSTEM_SMTP_TEST',
    'en',
    'SMTP test email — {{appName}}',
    '<h2>SMTP test email</h2>
<p>This is a test email from your {{appName}} instance.</p>
<p>If you received this message, your SMTP settings are working.</p>
<p>Sent by: {{instanceOrigin}}</p>
',
    NULL,
    '{"vars":["appName","instanceOrigin"],"example":{"appName":"Maia","instanceOrigin":"https://example.com"}}',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'email_template:SYSTEM_SMTP_TEST:zh-cn',
    'SYSTEM_SMTP_TEST',
    'zh-cn',
    'SMTP 测试邮件 — {{appName}}',
    '<h2>SMTP 测试邮件</h2>
<p>这是一封来自你的 {{appName}} 实例的测试邮件。</p>
<p>如果你收到了这封邮件，说明 SMTP 设置已生效。</p>
<p>发送来源：{{instanceOrigin}}</p>
',
    NULL,
    '{"vars":["appName","instanceOrigin"],"example":{"appName":"Maia","instanceOrigin":"https://example.com"}}',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'email_template:SIGNUP_INVITE:en',
    'SIGNUP_INVITE',
    'en',
    'You''re invited to join {{appName}}',
    '<h2>You''re invited</h2>
<p>You''ve been invited to join {{appName}}.</p>
<p><a href="{{inviteUrl}}">Accept invite</a></p>
<p>This link expires in {{expiresIn}}.</p>
',
    NULL,
    '{"vars":["appName","inviteUrl","expiresIn"],"example":{"appName":"Maia","inviteUrl":"https://example.com/signup?invite=...","expiresIn":"7 days"}}',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'email_template:SIGNUP_INVITE:zh-cn',
    'SIGNUP_INVITE',
    'zh-cn',
    '你已被邀请加入 {{appName}}',
    '<h2>邀请加入</h2>
<p>你已被邀请加入 {{appName}}。</p>
<p><a href="{{inviteUrl}}">接受邀请</a></p>
<p>该链接将在 {{expiresIn}} 后过期。</p>
',
    NULL,
    '{"vars":["appName","inviteUrl","expiresIn"],"example":{"appName":"Maia","inviteUrl":"https://example.com/signup?invite=...","expiresIn":"7 days"}}',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'email_template:SIGNUP_CONFIRMATION:en',
    'SIGNUP_CONFIRMATION',
    'en',
    'Confirm your {{appName}} email',
    '<h2>Confirm your email</h2>
<p>Welcome to {{appName}}.</p>
<p><a href="{{confirmationUrl}}">Confirm your email</a></p>
<p>This link expires in {{expiresIn}}.</p>
',
    NULL,
    '{"vars":["appName","confirmationUrl","expiresIn"],"example":{"appName":"Maia","confirmationUrl":"https://example.com/confirm?token=...","expiresIn":"1 hour"}}',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'email_template:SIGNUP_CONFIRMATION:zh-cn',
    'SIGNUP_CONFIRMATION',
    'zh-cn',
    '确认你的 {{appName}} 邮箱',
    '<h2>确认邮箱</h2>
<p>欢迎使用 {{appName}}。</p>
<p><a href="{{confirmationUrl}}">点击这里确认邮箱</a></p>
<p>该链接将在 {{expiresIn}} 后过期。</p>
',
    NULL,
    '{"vars":["appName","confirmationUrl","expiresIn"],"example":{"appName":"Maia","confirmationUrl":"https://example.com/confirm?token=...","expiresIn":"1 hour"}}',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'email_template:ADMIN_PASSWORD_RESET_LINK:en',
    'ADMIN_PASSWORD_RESET_LINK',
    'en',
    '{{appName}} password reset link',
    '<h2>Password reset</h2>
<p>An administrator generated a password reset link for {{email}}.</p>
<p><a href="{{resetUrl}}">Reset password</a></p>
<p>This link expires in {{expiresIn}}.</p>
',
    NULL,
    '{"vars":["appName","email","resetUrl","expiresIn"],"example":{"appName":"Maia","email":"user@example.com","resetUrl":"https://example.com/reset-password?token=...","expiresIn":"1 hour"}}',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'email_template:ADMIN_PASSWORD_RESET_LINK:zh-cn',
    'ADMIN_PASSWORD_RESET_LINK',
    'zh-cn',
    '{{appName}} 密码重置链接',
    '<h2>重置密码</h2>
<p>管理员为账号 {{email}} 生成了密码重置链接。</p>
<p><a href="{{resetUrl}}">点击这里重置密码</a></p>
<p>该链接将在 {{expiresIn}} 后过期。</p>
',
    NULL,
    '{"vars":["appName","email","resetUrl","expiresIn"],"example":{"appName":"Maia","email":"user@example.com","resetUrl":"https://example.com/reset-password?token=...","expiresIn":"1 hour"}}',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'email_template:AUTH_EMAIL_OTP:en',
    'AUTH_EMAIL_OTP',
    'en',
    'Your {{appName}} sign-in code',
    '<h2>Sign-in code</h2>
<p>Your {{appName}} one-time code is:</p>
<p style="font-size:20px;letter-spacing:2px;"><strong>{{code}}</strong></p>
<p>This code expires in {{expiresIn}}.</p>
',
    NULL,
    '{"vars":["appName","code","expiresIn"],"example":{"appName":"Maia","code":"123456","expiresIn":"10 minutes"}}',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'email_template:AUTH_EMAIL_OTP:zh-cn',
    'AUTH_EMAIL_OTP',
    'zh-cn',
    '你的 {{appName}} 登录验证码',
    '<h2>登录验证码</h2>
<p>你的 {{appName}} 一次性验证码是：</p>
<p style="font-size:20px;letter-spacing:2px;"><strong>{{code}}</strong></p>
<p>该验证码将在 {{expiresIn}} 后过期。</p>
',
    NULL,
    '{"vars":["appName","code","expiresIn"],"example":{"appName":"Maia","code":"123456","expiresIn":"10 minutes"}}',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'email_template:AUTH_MAGIC_LINK:en',
    'AUTH_MAGIC_LINK',
    'en',
    'Sign in to {{appName}}',
    '<h2>Sign in</h2>
<p>Click the link below to sign in to {{appName}}.</p>
<p><a href="{{magicLinkUrl}}">Sign in</a></p>
<p>This link expires in {{expiresIn}}.</p>
',
    NULL,
    '{"vars":["appName","magicLinkUrl","expiresIn"],"example":{"appName":"Maia","magicLinkUrl":"https://example.com/auth/magic?token=...","expiresIn":"10 minutes"}}',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'email_template:AUTH_MAGIC_LINK:zh-cn',
    'AUTH_MAGIC_LINK',
    'zh-cn',
    '登录到 {{appName}}',
    '<h2>登录</h2>
<p>点击下面的链接即可登录到 {{appName}}。</p>
<p><a href="{{magicLinkUrl}}">点击登录</a></p>
<p>该链接将在 {{expiresIn}} 后过期。</p>
',
    NULL,
    '{"vars":["appName","magicLinkUrl","expiresIn"],"example":{"appName":"Maia","magicLinkUrl":"https://example.com/auth/magic?token=...","expiresIn":"10 minutes"}}',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'email_template:RUN_FAILED_NOTIFICATION:en',
    'RUN_FAILED_NOTIFICATION',
    'en',
    '{{appName}} run failed: {{workflowName}}',
    '<h2>Run failed</h2>
<p>Your run for <strong>{{workflowName}}</strong> failed.</p>
<p><a href="{{runUrl}}">View details</a></p>
',
    NULL,
    '{"vars":["appName","workflowName","runUrl"],"example":{"appName":"Maia","workflowName":"My Workflow","runUrl":"https://example.com/runs/..."}}',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'email_template:RUN_FAILED_NOTIFICATION:zh-cn',
    'RUN_FAILED_NOTIFICATION',
    'zh-cn',
    '{{appName}} 运行失败：{{workflowName}}',
    '<h2>运行失败</h2>
<p>你的工作流 <strong>{{workflowName}}</strong> 本次运行失败。</p>
<p><a href="{{runUrl}}">查看详情</a></p>
',
    NULL,
    '{"vars":["appName","workflowName","runUrl"],"example":{"appName":"Maia","workflowName":"My Workflow","runUrl":"https://example.com/runs/..."}}',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'email_template:RUN_SUCCEEDED_NOTIFICATION:en',
    'RUN_SUCCEEDED_NOTIFICATION',
    'en',
    '{{appName}} run succeeded: {{workflowName}}',
    '<h2>Run succeeded</h2>
<p>Your run for <strong>{{workflowName}}</strong> succeeded.</p>
<p><a href="{{runUrl}}">View details</a></p>
',
    NULL,
    '{"vars":["appName","workflowName","runUrl"],"example":{"appName":"Maia","workflowName":"My Workflow","runUrl":"https://example.com/runs/..."}}',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'email_template:RUN_SUCCEEDED_NOTIFICATION:zh-cn',
    'RUN_SUCCEEDED_NOTIFICATION',
    'zh-cn',
    '{{appName}} 运行成功：{{workflowName}}',
    '<h2>运行成功</h2>
<p>你的工作流 <strong>{{workflowName}}</strong> 本次运行成功。</p>
<p><a href="{{runUrl}}">查看详情</a></p>
',
    NULL,
    '{"vars":["appName","workflowName","runUrl"],"example":{"appName":"Maia","workflowName":"My Workflow","runUrl":"https://example.com/runs/..."}}',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'email_template:RUN_CANCELED_NOTIFICATION:en',
    'RUN_CANCELED_NOTIFICATION',
    'en',
    '{{appName}} run canceled: {{workflowName}}',
    '<h2>Run canceled</h2>
<p>Your run for <strong>{{workflowName}}</strong> was canceled.</p>
<p><a href="{{runUrl}}">View details</a></p>
',
    NULL,
    '{"vars":["appName","workflowName","runUrl"],"example":{"appName":"Maia","workflowName":"My Workflow","runUrl":"https://example.com/runs/..."}}',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'email_template:RUN_CANCELED_NOTIFICATION:zh-cn',
    'RUN_CANCELED_NOTIFICATION',
    'zh-cn',
    '{{appName}} 运行已取消：{{workflowName}}',
    '<h2>运行已取消</h2>
<p>你的工作流 <strong>{{workflowName}}</strong> 本次运行已取消。</p>
<p><a href="{{runUrl}}">查看详情</a></p>
',
    NULL,
    '{"vars":["appName","workflowName","runUrl"],"example":{"appName":"Maia","workflowName":"My Workflow","runUrl":"https://example.com/runs/..."}}',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'email_template:TOTP_ENABLED_NOTIFICATION:en',
    'TOTP_ENABLED_NOTIFICATION',
    'en',
    'Two-factor authentication enabled — {{appName}}',
    '<h2>Two-factor authentication enabled</h2>
<p>Two-factor authentication has been enabled for your {{appName}} account ({{email}}).</p>
<p>If this was you, no further action is required.</p>
<p>If you didn''t do this, reset your password immediately and contact an administrator.</p>
<p>Time: {{time}}</p>
<p>Sent by: {{instanceOrigin}}</p>
',
    NULL,
    '{"vars":["appName","email","time","instanceOrigin"],"example":{"appName":"Maia","email":"user@example.com","time":"2026-02-01T12:34:56Z","instanceOrigin":"https://example.com"}}',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'email_template:TOTP_ENABLED_NOTIFICATION:zh-cn',
    'TOTP_ENABLED_NOTIFICATION',
    'zh-cn',
    '两步验证已启用 — {{appName}}',
    '<h2>两步验证已启用</h2>
<p>你的 {{appName}} 账号（{{email}}）已启用两步验证。</p>
<p>如果这是你本人操作，无需进一步处理。</p>
<p>如果这不是你操作，请立即重置密码并联系管理员。</p>
<p>时间：{{time}}</p>
<p>发送来源：{{instanceOrigin}}</p>
',
    NULL,
    '{"vars":["appName","email","time","instanceOrigin"],"example":{"appName":"Maia","email":"user@example.com","time":"2026-02-01T12:34:56Z","instanceOrigin":"https://example.com"}}',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'email_template:TOTP_DISABLED_NOTIFICATION:en',
    'TOTP_DISABLED_NOTIFICATION',
    'en',
    'Two-factor authentication disabled — {{appName}}',
    '<h2>Two-factor authentication disabled</h2>
<p>Two-factor authentication has been disabled for your {{appName}} account ({{email}}).</p>
<p>If this was you, no further action is required.</p>
<p>If you didn''t do this, reset your password immediately and contact an administrator.</p>
<p>Time: {{time}}</p>
<p>Sent by: {{instanceOrigin}}</p>
',
    NULL,
    '{"vars":["appName","email","time","instanceOrigin"],"example":{"appName":"Maia","email":"user@example.com","time":"2026-02-01T12:34:56Z","instanceOrigin":"https://example.com"}}',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'email_template:TOTP_DISABLED_NOTIFICATION:zh-cn',
    'TOTP_DISABLED_NOTIFICATION',
    'zh-cn',
    '两步验证已停用 — {{appName}}',
    '<h2>两步验证已停用</h2>
<p>你的 {{appName}} 账号（{{email}}）已停用两步验证。</p>
<p>如果这是你本人操作，无需进一步处理。</p>
<p>如果这不是你操作，请立即重置密码并联系管理员。</p>
<p>时间：{{time}}</p>
<p>发送来源：{{instanceOrigin}}</p>
',
    NULL,
    '{"vars":["appName","email","time","instanceOrigin"],"example":{"appName":"Maia","email":"user@example.com","time":"2026-02-01T12:34:56Z","instanceOrigin":"https://example.com"}}',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  );
