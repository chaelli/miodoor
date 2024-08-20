* Install Raspbian
* sudo apt-get install motion
* Update /etc/motion/motion.conf with the file from the repo
* /etc/default/motion => set to yes => file needs to contain 'start_motion_daemon=yes'
* sudo raspi-config => interfaces => enable camera
* reboot
* sudo modprobe bcm2835-v4l2 => also add this line to /etc/rc.local (without sudo)
* sudo service motion restart
* sudo apt-get install nodejs
* sudo apt-get install npm
* Copy config.json, script.js, package.json to /home/pi/mio
* Add keys to config.json
* npm install
* sudo npm install forever -g
* sudo apt-get install pigpio
* sudo raspi-config => interfaces > remote GPIO enable
* sudo systemctl enable pigpiod
* sudo systemctl start pigpiod
* node script.js => to test
* crontab -u pi -e
* => add line: @reboot /usr/local/bin/forever start /your/path/to/your/app.js

* install python3 and dependencies
* * echo "deb https://packages.cloud.google.com/apt coral-edgetpu-stable main" | sudo tee /etc/apt/sources.list.d/coral-edgetpu.list
* * curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | sudo apt-key add -
* * apt-get update
* * apt-get install libedgetpu1-std
* * apt-get install python3-pycoral
* sudo apt-get install screen
* screen python3 mio.py &
