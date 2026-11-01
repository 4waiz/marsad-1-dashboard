// MARSAD-1 (Team Kanban) - SatForge UAE 2026
// Tinkercad prototype of the CubeSat's EPS, thermal, payload and comms logic.
// Circuit: https://www.tinkercad.com/things/cY2kWDnTdZB
//   A0  TMP36          battery temperature
//   A1  photoresistor  sun sensor (sunlit / eclipse detection), 10k pull-down
//   A3  potentiometer  battery voltage stand-in (2S Li-ion, 6.0 - 8.4 V), powered from 3.3V
//   D13 red LED        battery heater (Kapton pad)
//   D7  green LED      payload imaging active (nadir mode)
//   D4  blue LED       UHF downlink / beacon
//   D9  micro servo    deployable antenna release
// Prints one JSON line per second, same format the MARSAD-1 dashboard reads.

#include <Servo.h>

const int PIN_TEMP = A0;
const int PIN_SUN = A1;
const int PIN_BATT = A3;
const int LED_HEATER = 13;
const int LED_IMAGING = 7;
const int LED_COMMS = 4;
const int PIN_ANTENNA = 9;

const float HEATER_ON_C = 5.0;
const float HEATER_OFF_C = 10.0;
const int SUN_THRESHOLD = 30;    // Tinkercad photoresistor: ~54 at default light, ~0 dark
const unsigned long ANTENNA_DELAY_MS = 5000;   // deploy after separation timer

Servo antenna;
bool antennaDeployed = false;
bool heaterOn = false;
unsigned long bootMs;

void setup() {
  Serial.begin(9600);
  pinMode(LED_HEATER, OUTPUT);
  pinMode(LED_IMAGING, OUTPUT);
  pinMode(LED_COMMS, OUTPUT);
  antenna.attach(PIN_ANTENNA);
  antenna.write(0);   // stowed
  bootMs = millis();
  Serial.println("MARSAD-1 boot - Team Kanban");
}

void loop() {
  float tempC = (analogRead(PIN_TEMP) * 5.0 / 1023.0 - 0.5) * 100.0;
  int sun = analogRead(PIN_SUN);
  float battV = 6.0 + analogRead(PIN_BATT) * (2.4 / 675.0);
  battV = min(battV, 8.4f);   // 3.3V full scale reads ~675
  float soc = constrain((battV - 6.0) / 2.4 * 100.0, 0, 100);
  bool sunlit = sun > SUN_THRESHOLD;
  unsigned long t = millis() - bootMs;

  if (!antennaDeployed && t > ANTENNA_DELAY_MS) {
    antenna.write(90);
    antennaDeployed = true;
    Serial.println("EVENT antenna deployed");
  }

  // battery heater with hysteresis
  if (tempC < HEATER_ON_C) heaterOn = true;
  if (tempC > HEATER_OFF_C) heaterOn = false;

  // ground-station pass simulated as 2 s out of every 10 s once the antenna is out
  bool inPass = antennaDeployed && (t / 1000) % 10 < 2;

  // CONOPS mode selection
  const char* mode;
  if (soc < 20 || !sunlit) mode = "safe";      // low battery or eclipse
  else if (inPass) mode = "gs";                // downlink
  else if (soc > 60) mode = "nadir";           // enough energy to image
  else mode = "sun";                           // sun pointing, charging

  bool imaging = strcmp(mode, "nadir") == 0;
  bool comms = strcmp(mode, "gs") == 0;
  digitalWrite(LED_HEATER, heaterOn ? HIGH : LOW);
  digitalWrite(LED_IMAGING, imaging ? HIGH : LOW);
  digitalWrite(LED_COMMS, comms ? HIGH : LOW);

  Serial.print("{\"soc\":");
  Serial.print(soc, 1);
  Serial.print(",\"v\":");
  Serial.print(battV, 2);
  Serial.print(",\"tbat\":");
  Serial.print(tempC, 1);
  Serial.print(",\"sun\":");
  Serial.print(sun);
  Serial.print(",\"mode\":\"");
  Serial.print(mode);
  Serial.print("\",\"heater\":");
  Serial.print(heaterOn ? "true" : "false");
  Serial.print(",\"antenna\":");
  Serial.print(antennaDeployed ? "true" : "false");
  Serial.println("}");

  delay(1000);
}
