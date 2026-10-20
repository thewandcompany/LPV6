console.log("Running factorytest.app.js");

/*
-------------------------------------------------------------------------------------
FACTORY TEST MODE

Saves JSON test data like this:
{
  serial:"ede4abfd-cfbc2696",
  address:"E5:F4:AC:2B:64:2F"
  result:"PASS"
  testSets:[
    {
      type:"Tests on complete watch",
      firmware:"2v12.1027",
      result:"FAIL",
      reason:"Check vibration motor & watch back cover"
      tests:[
        {
          type:"display",
          time:1646848366360,  // Unix epoch timestamp in milliseconds
          result:"OK"
        },
        {
          type:"flash",
          time:1646848366575,
          result:"OK"
        },
        {
          type:"buttons",
          time:1646848368285,
          result:"OK"
        },
        {
          type:"magnetometer",
          time:1646848371112,
          data:{x:294, y:562, z:1518},
          result:"OK"
        },
        {
          type:"bluetooth",
          time:1646848371231,
          data:{devices:17, maxRSSI:-47, addr:34:29:12:0e:71:3f},
          result:"OK"
        },
        {
          type:"accelerometer",
          time:1646848373361,
          data:{x:-30, y:50, z:-940},  // millig
          result:"OK"
        },
        {
          type:"barometer",
          time:1646848373533,
          data:{temperature:26, pressure:1015},
          result:"OK"
        },
        {
          type:"battery",
          time:1646848369504,
          data:{
            displayOn:3620,  // Millivolts
            displayOff:3830
          },
          result:"OK"
        }
      ]
    },
    { next data set... }
  ]
}

*/

var testData = require('Storage').readJSON('C:factorytestdata.json',1);
if (typeof(testData)!="object") testData={};
let previousTests = null;
if (testData.testSets) {
  previousTests = testData.testSets.slice(-1)[0];
  if (previousTests.tests) previousTests=previousTests.tests; 
  else previousTests = null;
} else testData.testSets=[];

if (typeof(state)!="object") state={};
state.clockMode=null;
clearWatch();
clearInterval();
Bangle.setCompassPower(0);
Bangle.setBarometerPower(0);
Bangle.setLCDBrightness(1);
Bangle.setLCDPower(1);
Bangle.setLCDTimeout(30);

let limits={
  batteryDropDisplayMin: 0.003, // Battery should drop a bit when the display turns on
  batteryDropDisplayMax: 0.040, // ...but not too much
  batteryDropVibMin: 0.01,      // Battery should drop a bit when the vibration motor runs
  batteryDropVibMax: 0.08,      // ...but not too much
  batteryChargerMin: 0.01,      // Charger should immediately boost the battery a bit
  temperatureMin: 15,
  temperatureMax: 35,
  pressureMin: 900,
  pressureMax: 1100,
  gravityTolerance: 0.2,
  // magNominalX: 200,         // Nominal X,Y,Z magnetometer values (when not on charging dock).  
  // magNominalY: 650,
  // magNominalZ: 2000,
  // magTolerance: 300,
  magNominalX: 1000,           // New magnetometer values are 4x larger than original firmwware
  magNominalY: 3500,
  magNominalZ: 10000,
  magTolerance: 4000,
  magMinTotal: 6,            // Total of x, y and z values should not be less than this
  magChargerChangeMin: 1000, // Attaching the charging dock should change the magnetometer Y-value quite a bit
  rssiMin: -70,             // Minimum RSSI value when scanning for nearby BLE devices
};

let bgCol='#000';
let fgCol='#FFF';
let battV=[];
let showBat;
let foundBLEdevice=false;

let dc=(a)=>require("heatshrink").decompress(atob(a));
let icons={
  tick: dc("jEYgQfckgFE3AEDgXgAocLwAFDlwWSlgWEh4WEgfACwnwFok8FokPFokDFokBIggAWA="),
  cross: dc("jEYgQURgOAAYMCoEC8AFBhYJB3AFBlwCEBAQOBCgYDBCwQPCCYQYCCwQYCCwQFHCIodEFIo1FIIpNELIplFPqIA="),
  power: dc("jEYgQKHyfGAgUL6fH8AFBn1D4O8AoP0gfAj8AAYIBDhdAAYMB8EOBoUA2EsAod4ngFDnk4AocsAoIACApgdBAAU8loFDvA1BAAWwIIIEBIIItCGIf0AoJZBMoNAgJlChf615xCgG//yHHA==")
};

let addr = NRF.getAddress().toUpperCase();  // BLE address
let ver = process.version.toUpperCase();    // Firmware version

// ---------------------------------------------
// Draw the main UI frame
// ---------------------------------------------
let drawFrame = c=>{
  if (c) {
    g.setBgColor(c).clearRect(30,101,210,140);
  }
  else {
    g.clear();
    g.setColor("#888");
    g.drawRect(30,-1,210,100);
    g.drawRect(30,141,210,240);
  }
  g.setColor(fgCol).setFontArchitekt15().setFontAlign(0,0);
  g.drawString(ver,120,112);
  g.drawString(addr.slice(12,14)+addr.slice(15,17),120,129);
  g.setBgColor(bgCol);
};

// ---------------------------------------------
// Draw info text on the screen
// ---------------------------------------------
let drawText = (t,y)=>{
  g.setColor(g.getBgColor()<992 ? fgCol : 0).setFontAlign(0,0);
  if (y==null) g.clearRect(31,142,209,239);
  if (t && typeof(t)=="string") {
    g.setFontGrotesk20();
    let words=t.split(" ");
    let lines=[""];
    let i=0;
    words.forEach(w=>{
      if (g.stringWidth(lines[i]+" "+w)<174) lines[i]+=" "+w;
      else lines[++i]=w;
    });
    lines.forEach((l,i)=>{
      g.drawString(l.trim(),120,(y||190)-10*lines.length+i*20);
    });
    console.log(t);
  }
  g.flip();
};

// ---------------------------------------------
// Log the test data
// ---------------------------------------------
let logText=[];
let logTimes=[];
let logIndex=0;
let log = t=>{ 
  if (typeof(t)=="string") {
//    if (logIndex==logText.length) logIndex++;
    logText.push(t);
    logTimes.push(getTime());
    console.log("--- "+t);
    logIndex=logText.length; // Jump to the end, so the new text is shown
  }
  else if (typeof(t)=="number") {
    if (t<0 && logIndex>5) logIndex--;
    if (t>0 && logIndex<logText.length) logIndex++;
  }
  g.setColor("#BBB").setBgColor(bgCol);
  g.setClipRect(31,0,209,99).clear();
  g.setFont('6x8').setFontAlign(-1,1);
  let lines=logText.slice(logIndex<12?0:logIndex-12,logIndex);
  lines.forEach((l,i)=>{
    let y=106-(lines.length-i)*8;
    g.drawString(l,35,y);
  });
  g.setClipRect(0,0,240,240);
};

// ---------------------------------------------
// Save the log to a CSV file
// ---------------------------------------------
let saveLog = _=>{
  let file = require("Storage").open("C:factorytestdata.csv","a");
  logText.forEach((l,i)=>{
    file.write(`${logTimes[i].toFixed(3)},"${l}"\n`);
  });
};

// ---------------------------------------------
// Add a test to the current set of tests
// ---------------------------------------------
let addTest = (type, result, data) => {
  let cT=testData.testSets.slice(-1)[0];  // Current test set
  cT.tests.push({
    type:type,
    time:Math.round(getTime()*1000),
    result:result
  });
  if (data) cT.tests.slice(-1)[0].data = data;
};

// ---------------------------------------------
// Save the test data
// ---------------------------------------------
let saveTests = (result,reason) => {
  let cT = testData.testSets.slice(-1)[0];
  cT.result = result;
  if (reason) cT.reason = reason;
  require("Storage").writeJSON("C:factorytestdata.json",testData);
};

// ---------------------------------------------
// Have we already passed a test?
// ---------------------------------------------
let alreadyTested = (testType) => {
  return (previousTests && previousTests.find(t=>(t.type==testType && t.result=="OK"))!=null);
};

// ---------------------------------------------
// Measure the battery voltage
// ---------------------------------------------
let getBattery = _=>{
  let v=0,vRef=0,avg=10;
  for (let i=0; i<avg; i++){
    v+=analogRead(D4)/avg;
    vRef+=E.getAnalogVRef()/avg;
  }
  return (v*2*vRef);
};

// ---------------------------------------------
// Power off the watch
// ---------------------------------------------
let powerOff = _=>{
  clearWatch();
  g.setBgColor('#888').clear();
  drawText ("Turning off");
  let offNow = _=>{
    Bangle.setLCDBrightness(0);
    Bangle.setLCDPower(0);
    setTimeout(_=>{
      Bangle.setCompassPower(0);
      Bangle.setBarometerPower(0);
      Bangle.off();
    },500);
  };
  // Don't actually turn off until BTN1 is released
  if (BTN1.read()) setWatch(offNow,BTN1,{edge:-1});
  else offNow();
};

// ---------------------------------------------
// Test the LCD display
// ---------------------------------------------
let testDisplay = _=>{
  clearWatch();
  Bangle.setLCDBrightness(1);
  if (alreadyTested("display")) {
    return new Promise ((res)=>{
      log("Display test already passed");
      res(1);
    });
  }
  let i=0,t=0,t2=0;
  let col=["#FFF","#F00","#0F0","#00F"];
  let showColour=i=>{
    g.setBgColor(col[i]).clear();
    if (t) clearTimeout(t);
    t=setTimeout(_=>{
      drawText("Display OK?",130);
      g.drawImage(icons.tick, 203,72);
      g.drawImage(icons.cross, 203,145);
      t=0;
    },1000);
  };
  g.setColor(0).setBgColor(col[i]).clear();
  drawText("Display check",130);
  t2=setTimeout(_=>showColour(i),1000);
  return new Promise ((res,rej)=>{
    let w1=setWatch(_=>{
      clearTimeout(t);
      if (++i==col.length) {
        clearWatch(w1);
        clearWatch(w2);
        g.setBgColor(bgCol);
        log ("Display test OK");
        addTest("display","OK");
        res (1);
      } else showColour(i);
    },BTN1,{edge:1,repeat:1});
    let w2=setWatch(_=>{
      clearTimeout(t);
      clearTimeout(t2);
      clearWatch(w1);
      g.setBgColor(bgCol);
      drawFrame();
      addTest("display","FAIL");
      rej("Display test failed");
    },BTN2,{edge:1});    
  });
};

// ---------------------------------------------
// Test the SPI Flash
// ---------------------------------------------
let testFlash = _=>{
  drawText("Testing flash");
  var f=require('Flash');
  return new Promise ((res,rej)=>{
    f.erasePage(0x607f0000);
    if (f.read(4,0x607f0000)!='255,255,255,255') {
      addTest("flash","FAIL - erase");
      rej('Flash erase failed!');
    }
    f.write([1,2,3,4],0x607f0000);
    if (f.read(4,0x607f0000)!='1,2,3,4') {
      addTest("flash","FAIL - write");
      rej('Flash write failed!');
    }
    f.erasePage(0x607f0000);
    drawText();
    addTest("flash","OK");
    log ("Flash test OK");
    res (1);
  });
};

// ---------------------------------------------
// Test the BLE radio
// ---------------------------------------------
let testBLE = _=>{
  return new Promise ((res,rej)=>{
    drawText("Bluetooth scanning...");
    try {
      NRF.requestDevice({ timeout:2000, filters:[{ namePrefix:"" }] }).then(a=>{
        data = {rssi:a.rssi, addr:a.id, name:a.name};
        log(`BLE: found ${a.name}`)
        log(` RSSI=${a.rssi} (${a.id})`);
        addTest("bluetooth","OK",data);
        foundBLEdevice=true;
        res(1);
      },e=>{
        log("BLE: no device found");
        addTest("bluetooth","No BLE device found");
        foundBLEdevice=false;
        res(0);
      });
    } catch (e){
      addTest("bluetooth","FAIL");
      rej("Unexpected error during BLE test");
    }
  });
};

// ---------------------------------------------
// Test the accelerometer
// ---------------------------------------------
let testAccel = _=>{
  drawText("Testing accelerometer");
  return new Promise ((res,rej)=>{
    let a=Bangle.getAccel();
    let data={x:Math.round(a.x*1000), y:Math.round(a.y*1000), z:Math.round(a.z*1000)};
    log (`Accel xyz=(${a.x.toFixed(2)},${a.y.toFixed(2)},${a.z.toFixed(2)})`);
    drawText();
    if ((Math.abs(a.mag-1)<limits.gravityTolerance) && (a.diff>0)) {
      addTest("accelerometer","OK",data);
      log ("Accelerometer OK");
      res (1);
    } else {
      addTest("accelerometer","FAIL",data);
      rej ("Unexpected accelerometer values");
    }
  });
};

// ---------------------------------------------
// Test the barometer
// ---------------------------------------------
let testBarometer = _=>{
  drawText("Testing barometer");
  return new Promise ((res,rej)=>{
    Bangle.getPressure().then(b=>{
      let data={
        temperature:Math.round(b.temperature),
        pressure:Math.round(b.pressure)
      };
      log (`Temperature: ${b.temperature.toFixed(2)} C`);
      log (`Pressure:    ${b.pressure.toFixed(2)} mbar`);
      drawText();
      if ((b.temperature<limits.temperatureMin) || (b.temperature>limits.temperatureMax)) {
        addTest("barometer","FAIL - temperature",data);
        rej (`Unexpected temperature: ${b.temperature.toFixed(1)}°C`);
      }
      else if ((b.pressure<limits.pressureMin) || (b.pressure>limits.pressureMax)) {
        addTest("barometer","FAIL - pressure",data);
        rej (`Unexpected pressure: ${b.pressure.toFixed(0)}mbar`);
      }
      else {
        addTest("barometer","OK",data);
        log ("Barometer OK");
        res (1);
      }
    });
  });
};

// ---------------------------------------------
// Test the magnetometer
// ---------------------------------------------
let testMag = _=>{
  drawText("Testing magnetometer");
  return new Promise ((res,rej)=>{
    let m=Bangle.getCompass();
    log(`Magnetometer:(${m.x},${m.y},${m.z})`);
    let data = {x:m.x, y:m.y, z:m.z};
    if (Math.abs(m.x)+Math.abs(m.y)+Math.abs(m.z)<limits.magMinTotal) {
      addTest("magnetometer","FAIL", data);
      rej ("No response from magnetometer");
    }
    else if ((Math.abs(m.x-limits.magNominalX)>limits.magTolerance) 
      || (Math.abs(m.y-limits.magNominalY)>limits.magTolerance) 
      || (Math.abs(m.z-limits.magNominalZ)>limits.magTolerance)) {
      addTest("magnetometer","FAIL", data);
      rej ("Unexpected magnetometer values");
    }
    else {
      addTest("magnetometer","OK", data);
      log ("Magnetometer OK");
      res (1);  
    }
  });
};

// ---------------------------------------------
// Test the buttons
// ---------------------------------------------
let buttons = [BTN1,BTN2,BTN3,BTN4];
let testButtons = _=>{
  let buttonsTested=0;
  clearWatch();
  drawText("Press each button");
  return new Promise ((res,rej)=>{
    if (alreadyTested("buttons")) {
      drawText();
      log("Buttons already passed");
      res(1);
    }
    let handleButton = i=>{
      let x=[211,211,0,0];
      let y=[10,141,141,10];
      let b=buttons[i].read();
      g.setColor(b ? "#0F0" : "#040").fillRect(x[i],y[i],x[i]+29,y[i]+90);
      if (buttonsTested==15) {
        //clearWatch();
        buttonsTested=255; // Prevent repeated entry here
        drawText();
        addTest("buttons","OK");
        log ("Button test OK");
        res (1);
      }
      buttonsTested |= 1<<i; 
    };
    buttons.forEach((b,i)=>setWatch(_=>handleButton(i),b,{repeat:1,edge:0}));
    setWatch(_=>log(-1),BTN3,{repeat:1});
    setWatch(_=>log(1),BTN4,{repeat:1});
  });
};

// ---------------------------------------------
// Test the battery
// ---------------------------------------------
let testBattery = _=>{
  drawText("Testing battery");
  return new Promise ((res,rej)=>{
    log("Testing battery");
    let b1 = getBattery();
    log (` - display on:  ${b1.toFixed(3)} V`);
    Bangle.setLCDBrightness(0);
    let i=0, b2=b1, data={};
    let batteryTimer=null, timer2 = null;
    let checkDisplayOff = _=>{
      Bangle.setLCDBrightness(0);
      timer2 = setTimeout(_=>{
        b2 = getBattery();  // Measure the battery while the display is off
        log (` - display off: ${b2.toFixed(3)} V`);
        Bangle.setLCDBrightness(1);
        data = {displayOn:Math.round(b1*1000), displayOff:Math.round(b2*1000)};
        if ((b2-b1)>limits.batteryDropDisplayMax) {
          clearInterval (batteryTimer);
          addTest("battery","FAIL", data);
          rej ("Large voltage drop when display turns on");
        } else if ((b2-b1)>=limits.batteryDropDisplayMin) {
          clearInterval (batteryTimer);
          addTest("battery","OK", data);
          log ("Battery test OK");
          res (1);
        } else {
          return false;
        }
      },500);
    };
    checkDisplayOff();
    batteryTimer = setInterval(_=>{
      b1 = getBattery();  // Measure the battery while the display is on again
      log (` - display on:  ${b1.toFixed(3)} V`);
      if (++i>4) {
        Bangle.setLCDBrightness(1);
        clearInterval (batteryTimer);
        if (timer2) clearTimeout (timer2);
        addTest("battery","FAIL", data);
        rej ("No battery voltage drop when display turns on");
      } else {
        checkDisplayOff();
      }
    },1000);
  });
};

// ---------------------------------------------
// Test the vibration motor
// ---------------------------------------------
let testVibration = _=>{
  drawText("Testing vibration motor");
  return new Promise ((res,rej)=>{
    log("Testing vibration motor");
    let b1 = getBattery();
    log (` - buzz off:    ${b1.toFixed(3)} V`);
    let i=0, b2=b1, data={};
    let buzzTimer=null, timer2=null;
    let buzzAndCheck = _=>{
      Bangle.buzz(200);
      timer2=setTimeout(_=>{
        b2 = getBattery();  // Measure the battery while the buzz is happening
        log (` - during buzz: ${b2.toFixed(3)} V`);
        data = {batteryBuzzOff:Math.round(b1*1000), batteryBuzzOn:Math.round(b2*1000)};
        if ((b1-b2)>limits.batteryDropVibMax) {
          clearInterval (buzzTimer);
          addTest("vibration","FAIL", data);
          rej ("Large voltage drop when vibration motor runs");
        } else if ((b1-b2)>=limits.batteryDropVibMin) {
          clearInterval (buzzTimer);
          addTest("vibration","OK", data);
          log ("Vibration test OK");
          res (1);
        } else {
          return false;
        }
      },100);
    };
    buzzAndCheck();
    buzzTimer = setInterval(_=>{
      b1 = getBattery();
      log (` - buzz off:    ${b1.toFixed(3)} V`);
      if (++i>4) {
        clearInterval (buzzTimer);
        if (timer2) clearTimeout (timer2);
        addTest("vibration","FAIL", data);
        rej ("Check vibration motor & watch back cover");
      } else {
        buzzAndCheck();
      }
    },500);
  });
};

// ---------------------------------------------
// Test the charger
// ---------------------------------------------
let testCharger = _=>{
  drawText("Testing charger");
  Bangle.removeAllListeners("charging");
  return new Promise ((res,rej)=>{
    Bangle.on("charging",charging=>{
      if (!charging) setTimeout(_=>{
        log("Testing charger");
        let b1 = getBattery();
        log (` - not charging: ${b1.toFixed(2)} V`);
        drawText("Attach charger");
        Bangle.on("charging",charging=>{
          if (charging) {
            Bangle.removeAllListeners("charging");
            setTimeout(_=>{
              let b2 = getBattery();
              log (` - charging:     ${b2.toFixed(2)} V`);
              drawText();
              let data = {notCharging:Math.round(b1*1000), charging:Math.round(b2*1000)};
              if ((b2-b1)<limits.batteryChargerMin) {
                addTest("charger","FAIL", data);
                rej ("Not charging");
              } else {
                addTest("charger","OK", data);
                log ("Charging test OK");
                res (1);
              }
            },500);
          }
        });
      },500);
    });
    if (Bangle.isCharging()) drawText("Remove charger");
    else {
      drawText("Testing charger");
      Bangle.emit("charging",false);
    }
  });
};



// ---------------------------------------------
// Show power off button
// ---------------------------------------------
let showPowerOff = _=>{
  g.clearRect(211,10,240,100);
  g.setColor(fgCol).drawImage(icons.power, 211,75);
  setWatch(powerOff,BTN1);
};

// ---------------------------------------------
// Run all tests
// ---------------------------------------------
let runTests = _=>{
  log("------ Starting tests ------");
  log("Firmware: "+ver);
  log(" Address: "+addr);
  log("Serial #: "+getSerial());
  testData.serial = getSerial();
  testData.address = addr;
  testData.testSets.push({
    firmware:ver,
    time:Math.round(getTime()*1000),
    tests:[]
  });
  Bangle.setCompassPower(1);
  Bangle.setBarometerPower(1);
  Bangle.removeAllListeners("charging");
  showBat=false;
  testDisplay().then(_=>{
    drawFrame();
    return testFlash();
  }).then(_=>{
    return testBLE();
  }).then(_=>{
    return testAccel();
  }).then(_=>{
    return testBarometer();
  }).then(_=>{
    return testMag();
  }).then(_=>{
    return testButtons();
  }).then(_=>{
    return testBattery();
  }).then(_=>{
    return testVibration();
  }).then(_=>{
    return testCharger();
  }).then(_=>{
    drawFrame("#0B0");
    try {
      if (foundBLEdevice) {
        drawText("PASSED TESTS ! Press top right to power off");
        saveTests("PASS");
      } else {
        drawText("OK except BLE - press top right to power off");
        saveTests("PASS except BLE");
      }
      saveLog(); 
      log("Saved test data");
    } catch (e){
      log("Failed to save test data: "+e);
    }
    showPowerOff();
  }).catch(e=>{
    log(e);
    if (typeof(e)=="string" && e.includes("back cover")) drawFrame("#F80");
    else drawFrame("#F00");
    drawText(e);
    saveTests("FAIL",e);
    saveLog(); 
    log("Saved test data");
    showPowerOff();
  });
};

// ---------------------------------------------
// Measure battery voltage every 1 second
// ---------------------------------------------
let battTimer = setInterval(_=>{
  let v=getBattery();
  if (showBat) {
    g.clearRect(40,193,200,210);
    g.setFontArchitekt15().setFontAlign(0,0);
    g.setColor(Bangle.isCharging()?'#2F2':'#888');
    g.drawString(v.toFixed(2)+" V",120,200);  
  }
  if (battV.length>=240) battV.shift();
  battV.push(v);
},1000);

// ---------------------------------------------
// Draw initial screen
// ---------------------------------------------
let drawAll = _=>{
  g.reset().setBgColor(bgCol).setColor(fgCol).clear();
  g.setFontArchitekt15().setFontAlign(0,0);
  g.drawString(ver,120,22);
  g.drawString(addr,120,40);
  g.setColor("#888").drawString('PRESS ANY BUTTON',120,150);
  g.setFontArchitekt35().setColor(fgCol);
  g.drawString(addr.slice(12,14)+addr.slice(15,17),120,110);
  showBat=true;
  Bangle.setLCDPower(1);
  Bangle.setLCDBrightness(1);
  Bangle.buzz();
  buttons.forEach(b=>setWatch(runTests,b));
};

drawAll();
