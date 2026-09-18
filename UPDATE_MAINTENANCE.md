git pull

cd /var/www/hiusa/server

composer install --no-dev --prefer-dist --optimize-autoloader --no-interaction
sudo -u www-data php artisan migrate --force
sudo -u www-data php artisan optimize:clear
sudo -u www-data php artisan optimize

cd /var/www/hiusa/client

npm ci
npm run build

cd /var/www/hiusa/ai-service

.venv/bin/python -m pip install -r requirements.txt

sudo systemctl stop hiusa-fingerprint
cd /var/www/hiusa/fingerprint-matcher

dotnet restore
dotnet publish -c Release -o publish

sudo systemctl restart php8.3-fpm hiusa-ai hiusa-fingerprint hiusa-queue hiusa-scheduler
sudo nginx -t
sudo systemctl reload nginx

cd /var/www/hiusa/server
sudo -u www-data php artisan up
sudo systemctl is-active nginx php8.3-fpm mysql hiusa-ai hiusa-fingerprint hiusa-queue hiusa-scheduler

curl -fsS "https://YOUR_STATIC_IP/up"

