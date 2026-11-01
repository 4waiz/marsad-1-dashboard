// MARSAD-1 prototype telemetry — Team Kanban, SatForge UAE 2026
// ESP32-S3 flight-computer sketch that reads the prototype sensors and prints one
// JSON line per second over USB serial (115200 baud). The dashboard's
// "Connect prototype (USB)" button reads these lines through Web Serial.
//
// Wiring (shared I2C bus: SDA = GPIO8, SCL = GPIO9):
//   INA219  (0x40)  bus voltage / current between MPPT charger and loads
//   BME280  (0x76)  internal temperature
//   AS7341  (0x39)  spectral sensor (payload)
//   DS18B20 OneWire on GPIO4  battery temperature
//   Heater MOSFET gate on GPIO5
//
// Libraries: Adafruit INA219, Adafruit BME280, Adafruit AS7341, OneWire, DallasTemperature

#include <Wire.h>
#include <Adafruit_INA219.h>
#include <Adafruit_BME280.h>
#include <Adafruit_AS7341.h>
#include <OneWire.h>
#include <DallasTemperature.h>

constexpr int PIN_SDA = 8;
constexpr int PIN_SCL = 9;
constexpr int PIN_ONEWIRE = 4;
constexpr int PIN_HEATER = 5;
constexpr float BATTERY_WH = 25.16f;   // 2S 18650, 7.4 V x 3.4 Ah
constexpr float HEATER_ON_C = 5.0f;
constexpr float HEATER_OFF_C = 10.0f;

Adafruit_INA219 ina;
Adafruit_BME280 bme;
Adafruit_AS7341 spec;
OneWire oneWire(PIN_ONEWIRE);
DallasTemperature batTemp(&oneWire);

bool haveIna = false, haveBme = false, haveSpec = false;
float socPct = 80.0f;
bool heaterOn = false;
unsigned long lastMs = 0;

// Coarse SoC from open-circuit voltage of a 2S pack, used to seed the coulomb counter.
float socFromVoltage(float v) {
  float pct = (v - 6.4f) / (8.4f - 6.4f) * 100.0f;
  return constrain(pct, 0.0f, 100.0f);
}

// Normalised Difference Chlorophyll Index using the nearest AS7341 bands
// (F8 ~ 680 nm as the chlorophyll absorption band, NIR ~ 910 nm as the red-edge proxy).
float ndci() {
  if (!haveSpec || !spec.readAllChannels()) return NAN;
  float red = spec.getChannel(AS7341_CHANNEL_680nm_F8);
  float edge = spec.getChannel(AS7341_CHANNEL_NIR);
  if (red + edge <= 0) return NAN;
  return (edge - red) / (edge + red);
}

void setup() {
  Serial.begin(115200);
  Wire.begin(PIN_SDA, PIN_SCL);
  pinMode(PIN_HEATER, OUTPUT);
  digitalWrite(PIN_HEATER, LOW);

  haveIna = ina.begin();
  haveBme = bme.begin(0x76);
  haveSpec = spec.begin();
  if (haveSpec) {
    spec.setATIME(100);
    spec.setASTEP(999);
    spec.setGain(AS7341_GAIN_256X);
  }
  batTemp.begin();
  if (haveIna) socPct = socFromVoltage(ina.getBusVoltage_V());
  lastMs = millis();
}

void loop() {
  unsigned long now = millis();
  float dt = (now - lastMs) / 1000.0f;
  lastMs = now;

  float busV = haveIna ? ina.getBusVoltage_V() : NAN;
  float currentA = haveIna ? ina.getCurrent_mA() / 1000.0f : NAN;  // + = discharge into loads
  float loadW = haveIna ? busV * currentA : NAN;

  if (haveIna) {
    socPct -= (loadW * dt / 3600.0f) / BATTERY_WH * 100.0f;
    socPct = constrain(socPct, 0.0f, 100.0f);
  }

  batTemp.requestTemperatures();
  float tBat = batTemp.getTempCByIndex(0);
  float tInt = haveBme ? bme.readTemperature() : NAN;

  // Simple bang-bang battery heater with hysteresis
  if (tBat != DEVICE_DISCONNECTED_C) {
    if (!heaterOn && tBat < HEATER_ON_C) heaterOn = true;
    if (heaterOn && tBat > HEATER_OFF_C) heaterOn = false;
    digitalWrite(PIN_HEATER, heaterOn ? HIGH : LOW);
  }

  float index = ndci();

  Serial.print("{\"soc\":");
  Serial.print(socPct, 1);
  if (haveIna) {
    Serial.print(",\"v\":"); Serial.print(busV, 2);
    Serial.print(",\"load\":"); Serial.print(loadW, 2);
  }
  if (haveBme) { Serial.print(",\"tint\":"); Serial.print(tInt, 1); }
  if (tBat != DEVICE_DISCONNECTED_C) { Serial.print(",\"tbat\":"); Serial.print(tBat, 1); }
  if (!isnan(index)) { Serial.print(",\"ndci\":"); Serial.print(index, 3); }
  Serial.print(",\"heater\":"); Serial.print(heaterOn ? "true" : "false");
  Serial.println("}");

  delay(1000);
}
