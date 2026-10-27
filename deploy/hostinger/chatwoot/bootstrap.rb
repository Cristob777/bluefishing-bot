# Idempotente. Se ejecuta con: bundle exec rails runner /tmp/crmbot_bootstrap.rb
# Entradas por ENV (nunca por argumentos): CW_ACCOUNT_NAME, CW_ADMIN_NAME, CW_ADMIN_EMAIL,
# CW_ADMIN_PASSWORD (solo si el usuario no existe), CW_BOT_URL, CW_WEBHOOK_SECRET.
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

  bot = AgentBot.find_or_initialize_by(account_id: account.id, name: "Matías")
  secret = ENV["CW_WEBHOOK_SECRET"].to_s
  url = ENV.fetch("CW_BOT_URL")
  # Chatwoot < v4.14 no firma webhooks del Agent Bot: se autentica con ?token= en la URL interna.
  unless bot.has_attribute?(:secret) || secret.empty?
    url = "#{url}#{url.include?('?') ? '&' : '?'}token=#{ERB::Util.url_encode(secret)}"
  end
  bot.outgoing_url = url
  bot.description = "Bot de ventas (crm-bot)" if bot.respond_to?(:description=)
  bot.save!
  if bot.has_attribute?(:secret)
    secret.empty? ? (secret = bot.secret.to_s) : bot.update_column(:secret, secret)
  end
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

  puts "CRMBOT_RESULT CHATWOOT_ACCOUNT_ID=#{account.id} CHATWOOT_INBOX_ID=#{inbox.id} CHATWOOT_BOT_TOKEN=#{token} CHATWOOT_WEBHOOK_SECRET=#{secret}"
end
