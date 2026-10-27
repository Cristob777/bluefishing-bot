# Idempotente. Se ejecuta con: bundle exec rails runner /tmp/crmbot_bootstrap.rb
# Entradas por ENV (nunca por argumentos): CW_ACCOUNT_NAME, CW_ADMIN_NAME, CW_ADMIN_EMAIL,
# CW_ADMIN_PASSWORD (solo si el usuario no existe), CW_BOT_URL, CW_WEBHOOK_SECRET, CW_LABELS_EMAIL.
# Salida: una única línea "CRMBOT_RESULT k=v ..." que install.sh guarda en .env.production.
ActiveRecord::Base.transaction do
  email = ENV.fetch("CW_ADMIN_EMAIL").downcase
  user = User.find_by(email: email)
  account = user&.accounts&.first || Account.find_by(name: ENV.fetch("CW_ACCOUNT_NAME")) ||
            Account.create!(name: ENV.fetch("CW_ACCOUNT_NAME"), locale: "es")
  unless user
    user = User.new(name: ENV.fetch("CW_ADMIN_NAME"), email: email, password: ENV.fetch("CW_ADMIN_PASSWORD"))
    user.skip_confirmation! if user.respond_to?(:skip_confirmation!)
    user.save!
  end
  AccountUser.find_or_create_by!(account_id: account.id, user_id: user.id) { |au| au.role = :administrator }
  user.update!(type: "SuperAdmin") if user.respond_to?(:type) && user.type.blank?

  # Chatwoot >= v4.14: AgentBot incluye WebhookSecretable (agent_bots.secret, has_secure_token) y firma cada
  # webhook con X-Chatwoot-Signature = "sha256=" + HMAC_SHA256(secret, "<timestamp>.<body>").
  raise "Chatwoot sin agent_bots.secret: se requiere >= v4.14 (CHATWOOT_IMAGE_TAG)" unless AgentBot.column_names.include?("secret")
  bot = AgentBot.find_or_initialize_by(account_id: account.id, name: "Matías")
  bot.outgoing_url = ENV.fetch("CW_BOT_URL")
  bot.description = "Bot de ventas (crm-bot)" if bot.respond_to?(:description=)
  secret = ENV["CW_WEBHOOK_SECRET"].to_s
  # Asignación por el modelo (no update_column) para respetar `encrypts :secret` si hay cifrado configurado.
  bot.secret = secret unless secret.empty?
  bot.save!
  secret = bot.reload.secret.to_s
  token = (bot.access_token || bot.create_access_token!).token

  inbox = account.inboxes.find_by(name: "Bot API")
  unless inbox
    channel = Channel::Api.create!(account_id: account.id)
    inbox = account.inboxes.create!(name: "Bot API", channel: channel)
  end
  abi = AgentBotInbox.find_or_initialize_by(inbox_id: inbox.id)
  abi.agent_bot_id = bot.id
  abi.account_id = account.id if abi.has_attribute?(:account_id)
  abi.save!

  # Usuario agente dedicado para etiquetar en el handoff: la API de labels rechaza tokens de Agent Bot (401).
  # Rol agent (no admin), solo miembro del inbox del bot. Contraseña aleatoria que nadie usa.
  label_email = ENV.fetch("CW_LABELS_EMAIL").downcase
  label_user = User.find_by(email: label_email)
  unless label_user
    label_user = User.new(name: "crm-bot etiquetas", email: label_email,
                          password: "Aa1!#{SecureRandom.hex(24)}")
    label_user.skip_confirmation! if label_user.respond_to?(:skip_confirmation!)
    label_user.save!
  end
  AccountUser.find_or_create_by!(account_id: account.id, user_id: label_user.id) { |au| au.role = :agent }
  InboxMember.find_or_create_by!(inbox_id: inbox.id, user_id: label_user.id)
  Label.find_or_create_by!(account_id: account.id, title: "humano")
  labels_token = (label_user.access_token || label_user.create_access_token!).token

  puts "CRMBOT_RESULT CHATWOOT_ACCOUNT_ID=#{account.id} CHATWOOT_INBOX_ID=#{inbox.id} CHATWOOT_BOT_TOKEN=#{token} CHATWOOT_WEBHOOK_SECRET=#{secret} CHATWOOT_LABELS_TOKEN=#{labels_token}"
end
