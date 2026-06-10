'use strict';

/**
 * availability-core — the salon's OWN availability math, lifted from cbbe2.js.
 *
 * `FillTimeArray`, `ToMinutes`, and `pad2` below are copied VERBATIM from the live
 * booking widget (vendor/cbbe2.snapshot.js) so our open-slot calculation is byte-for-byte
 * the same logic the website runs — the strongest guarantee against showing a slot the
 * salon wouldn't, i.e. against double-booking. Only the surrounding scaffolding is ours:
 *
 *   - module-scoped versions of the globals the lifted code reads/writes
 *   - a tiny `timezoneJS` shim (returns the merchant tz offset; Honolulu = +600, no DST)
 *   - `moment.tz.setDefault(merchant tz)` so the lifted code's bare `moment()` operates in
 *     salon-local time. That makes `offsetdiff` and `diff` compute to 0 — exactly the case
 *     the original handles when the browser and salon share a timezone.
 *   - `computeEmployeeDuration()` (the per-employee service/duration check, adapted from
 *     FillEmployeesAndTimeSlots, DOM removed) and a `computeAvailability()` orchestrator.
 *
 * REFRESH PROCEDURE: if the salon updates cbbe2.js, re-snapshot it, diff FillTimeArray, and
 * re-paste it here. Keep this file a faithful copy — do not "improve" the lifted logic.
 */

const moment = require('moment-timezone');

const DEBUG = process.env.AVAIL_DEBUG === '1';
// Shadow `console` so the lifted code's very chatty console.log is silent unless debugging.
const console = { log: DEBUG ? global.console.log.bind(global.console) : function () {} };

// --- timezoneJS shim: the lifted code only calls new timezoneJS.Date(tz).getTimezoneOffset() ---
const timezoneJS = {
  Date: class {
    constructor(tz) {
      this.tz = tz;
    }
    setTimezone(tz) {
      this.tz = tz;
    }
    getTimezoneOffset() {
      // JS convention: minutes WEST of UTC (Honolulu UTC-10 => +600).
      return -moment.tz(this.tz).utcOffset();
    }
  },
};

// --- static salon config (set once via configure) ---
let jsonMerchant = null;
let employeeJSON = [];
let serviceJSON = [];
let advance = 0; // lead-time hours before the first bookable slot today
let useFormat = 'M/DD/YYYY hh:mm A';
let salonTz = 'Pacific/Honolulu';

// --- per-call mutable state mirroring cbbe2.js globals (reset every computeAvailability) ---
let apptJSON = [];
let thisDateYear;
let thisDateMonth; // 0-indexed (moment month)
let thisDateDay;
let thisDate;
let startDate;
let offsetdiff = 0;
let startDayAppt = -1;
let endDayAppt = -1;
let counter = 0;
let earliestEmployeeTime = 9000;
let earliestEmployeeNumber = -1;
let employeeTimeString = [];

function configure(cfg) {
  jsonMerchant = cfg.jsonMerchant;
  employeeJSON = cfg.employeeJSON || [];
  serviceJSON = cfg.serviceJSON || [];
  advance = Number(cfg.advance) || 0;

  if (jsonMerchant) {
    // mirror cbbe2.js:849-861 timezone normalization + date-format selection
    if (jsonMerchant.timezone === 'EST') jsonMerchant.timezone = 'America/New_York';
    else if (jsonMerchant.timezone === 'CST') jsonMerchant.timezone = 'America/Chicago';
    salonTz = process.env.SALON_TZ || jsonMerchant.timezone || 'Pacific/Honolulu';
    useFormat = jsonMerchant.timezone.includes('Europe')
      ? 'D/MM/YYYY hh:mm A'
      : 'M/DD/YYYY hh:mm A';
  }
  // Make bare moment() in the lifted code run in salon-local time (drives offsetdiff -> 0).
  moment.tz.setDefault(salonTz);
}

// =====================================================================================
// ===== BEGIN VERBATIM LIFT FROM cbbe2.snapshot.js (do not edit logic) ================
// =====================================================================================

// cbbe2.js:1114
function ToMinutes(timeSpan) {
  var chunks = timeSpan.split(':');
  if (chunks.length == 3) {
    return parseInt(chunks[0]) * 60 + parseInt(chunks[1]);
  }
  return 0;
}

// cbbe2.js:2107
function pad2(number) {
  return (number < 10 ? '0' : '') + number;
}

// cbbe2.js:1685
function FillTimeArray(z, totalDuration) {
  var dtx = new timezoneJS.Date(jsonMerchant.timezone);
  dtx.setTimezone(jsonMerchant.timezone);
  var offsetx = dtx.getTimezoneOffset();
  var offsetbrowserx = -1 * moment().utcOffset();
  offsetdiff = offsetbrowserx - dtx.getTimezoneOffset();
  console.log('offsettzdiff=' + offsetdiff);
  // if dayMode, we need to use the year, month, date that is being checked instead of using the selected date
  var useYear = thisDateYear;
  var useMonth = thisDateMonth;
  var useDay = thisDateDay;
  var useDate = thisDate;

  var employee = employeeJSON[z];
  var dayOfWeek = new Date(useDate).getDay();
  // calc total service duration
  console.log('creating slots for useDate:' + useDate + 'dow:' + dayOfWeek);

  var DateTimeMax = moment(useDate).add(23, 'h').toDate();
  var DateTimeMin = moment(useDate).add(5, 'h').toDate();

  var employeeDayShifts = employee.shift[dayOfWeek];
  // check for holiday shift...either by date or by explicity force of use...
  if (employee.hasOwnProperty('holidayshift')) {
    console.log('has alternate shift');
    if (employee.hasOwnProperty('holidayhours')) {
      console.log('alternate shift force:' + employee.holidayhours);
      if (employee.holidayhours == true) {
        employeeDayShifts = employee.holidayshift[dayOfWeek];
      } else {
        var checkunixtime = startDate.unix();
        console.log(
          'alternate shift date secs:' +
            checkunixtime +
            ' start:' +
            employee.holidaystart +
            ' end:' +
            employee.holidayend
        );
        if (checkunixtime >= employee.holidaystart && checkunixtime <= employee.holidayend) {
          var useShifts = true;
          // if employee has a holiday shift, calculate if it's alternating or not
          if (employee.hasOwnProperty('onoff')) {
            // figure out weeks from the start date...if week is 1,3,5, etc.(odd), then alternating schedule is on
            if (employee.onoff == true) {
              var secsdiff = checkunixtime - employee.holidaystart;
              var weeksince = Math.floor(secsdiff / (3600 * 24 * 7));
              console.log(
                employee.name + ' ' + startDate + ' weeks since start of alternate schedule:' + weeksince
              );
              // if even..., then it's within the 7 days, etc. so it applies, otherwise, it's odd...doesn't apply
              if (weeksince % 2 != 0) {
                console.log('dont use alternating schedule ' + startDate.date());
                useShifts = false;
              }
            }
          }
          if (useShifts) {
            console.log('use alternating schedule ' + startDate.date());
            employeeDayShifts = employee.holidayshift[dayOfWeek];
          }
        }
      }
    }
  }

  var relativeWorkStart = (employeeDayShifts.workStart - 1440 * dayOfWeek) / 5;
  var relativeWorkEnd = (employeeDayShifts.workEnd - 1440 * dayOfWeek) / 5;
  var relativeBreakStart = (employeeDayShifts.breakStart - 1440 * dayOfWeek) / 5;
  var relativeBreakEnd = (employeeDayShifts.breakEnd - 1440 * dayOfWeek) / 5;
  console.log(
    'relative times:' +
      (relativeWorkStart * 5) / 60 +
      ' ' +
      (relativeWorkEnd * 5) / 60 +
      ' ' +
      (relativeBreakStart * 5) / 60 +
      ' ' +
      (relativeBreakEnd * 5) / 60
  );

  var daysOff = [];
  var daysOn = [];

  // fill in timeOffArray with all times first
  var len = employee.shiftMods.length;
  for (var i = 0; i < len; i++) {
    var mombeg = moment(employee.shiftMods[i].begin);
    //var momend = moment(employee.shiftMods[i].end) ;
    if (useYear == mombeg.year() && useDay == mombeg.date() && useMonth == mombeg.month()) {
      if (employee.shiftMods[i].status == 0) {
        daysOff.push(employee.shiftMods[i]);
        console.log('got day off');
      } else {
        daysOn.push(employee.shiftMods[i]);
        console.log('got day on');
      }
    }
  }
  var timeOffArray = [];
  for (i = 0; i < 350; i++) {
    timeOffArray[i] = false; // available the entire day all 24 hours to begin with
  }
  // if today, block til now and then block two extra hours....
  var mtoday = moment();
  if (useYear == mtoday.year() && useMonth == mtoday.month() && useDay == mtoday.date()) {
    // calc end time in minutes
    var minInDay = mtoday.hours() * 60 + mtoday.minutes() + 60 * advance;
    var end = minInDay / 5;
    console.log('blocking til:' + (end * 5) / 60 + ' advance:' + advance);
    for (i = 0; i < end; i++) {
      timeOffArray[i] = true;
    }
  }

  var count = daysOn.length;
  if (!employeeDayShifts.workOn) {
    console.log('blocking full day');
    for (var i = 0; i < 350; i++) {
      timeOffArray[i] = true;
    }
  } // at least 1 shift
  else {
    //Add TimeOff for time from 5:00am to start time
    var startMinutes = 60;
    //if no daysOn then we can simplify the adding of work hours to the max 2 shifts that are separated by a break at most
    console.log('blocking 0 to ' + (relativeWorkStart * 5) / 60);
    for (var i = 0; i < relativeWorkStart; i++) {
      timeOffArray[i] = true;
    }
    //single shift...off from end of shift to end of day
    if (employeeDayShifts.workOn) {
      //Add TimeOff for time after end of workday
      startMinutes = relativeWorkEnd;
      console.log('blocking ' + (relativeWorkEnd * 5) / 60 + ' to ' + (350 * 5) / 60);
      for (var i = relativeWorkEnd; i < 350; i++) {
        timeOffArray[i] = true;
      }
    } //double shift...off from  break beginning to end
    if (employeeDayShifts.breakOn) {
      console.log('blocking break ' + (relativeBreakStart * 5) / 60 + ' to ' + (relativeBreakEnd * 5) / 60);
      for (var i = relativeBreakStart; i < relativeBreakEnd; i++) {
        timeOffArray[i] = true;
      }
    }
  }
  if (count > 0) {
    // daysOn count
    var len = daysOn.length;
    for (i = 0; i < len; i++) {
      //var beginOnMinutes = (int) (dayOn.Value.Begin_UTC.ToLocalTime().TimeOfDay.TotalMinutes);
      var beginOnDate = moment(daysOn[i].begin);
      var beginOnMinutes = beginOnDate.hour() * 60 + beginOnDate.minute();
      var endOnDate = moment(daysOn[i].end);
      var endOnMinutes = endOnDate.hour() * 60 + endOnDate.minute();

      beginOnMinutes /= 5;
      endOnMinutes /= 5;
      if (offsetdiff != 0) {
        beginOnMinutes += offsetdiff / 5;
        endOnMinutes += offsetdiff / 5;
        console.log('offsettzdiffapplied=' + offsetdiff);
      }

      console.log(
        'XXXXXXXXXXXXXXXXXXXX adding back:' + (beginOnMinutes * 5) / 60 + ' to:' + (endOnMinutes * 5) / 60
      );
      for (var j = beginOnMinutes; j < endOnMinutes; j++) {
        if (j < 350) {
          timeOffArray[j] = false;
        }
      }
    }
  }
  // if today, block til now and then block two extra hours....
  var mtoday = moment();
  if (useYear == mtoday.year() && useMonth == mtoday.month() && useDay == mtoday.date()) {
    // calc end time in minutes
    var minInDay = mtoday.hours() * 60 + mtoday.minutes() + 60 * advance;
    var end = minInDay / 5;
    console.log('blockingx til:' + (end * 5) / 60 + ' advance:' + advance);
    for (i = 0; i < end; i++) {
      timeOffArray[i] = true;
    }
  }

  var len = daysOff.length;
  console.log('got entries for day off:' + len);
  for (i = 0; i < len; i++) {
    var beginOffDate = moment(daysOff[i].begin);
    var beginMinutes = beginOffDate.hour() * 60 + beginOffDate.minute();
    var endOffDate = moment(daysOff[i].end);
    var endMinutes = endOffDate.hour() * 60 + endOffDate.minute();

    beginMinutes /= 5;
    endMinutes /= 5;
    if (offsetdiff != 0) {
      beginMinutes += offsetdiff / 5;
      endMinutes += offsetdiff / 5;
      console.log('offsettzdiffapplied=' + offsetdiff);
    }

    console.log('begin:' + beginMinutes + ' end:' + endMinutes);
    console.log('begin:' + daysOff[i].begin + ' end:' + daysOff[i].end);

    console.log(
      'XXXXXXXXXXXXXXXXXXXX removing:' + (beginMinutes * 5) / 60 + ' to:' + (endMinutes * 5) / 60
    );
    if (endMinutes < beginMinutes) {
      beginMinutes = 10;
      endMinutes = 250;
    }
    for (var j = beginMinutes; j < endMinutes; j++) {
      timeOffArray[j] = true;
    }
  }
  // right here we should have a time off array for every 5 minutes of a single day
  //
  // block off all current appointments for this date
  //
  // loop through all appointments and find ones that have localSTart (convert to date) that is on the date picked.
  // create array appointments[employee] = localStart + duration of various services in unix seconds. appointments
  // loop through all appointments and save the start time and end time of each part
  var arrayLength = apptJSON.length;
  console.log('got:' + arrayLength + ' appointments');
  var addNext = true;
  var foundAtLeastOne = false;

  var dt = new timezoneJS.Date(jsonMerchant.timezone);
  dt.setTimezone(jsonMerchant.timezone);
  var offset = dt.getTimezoneOffset();
  console.log('offset:' + offset);
  var offsetbrowser = -1 * moment().utcOffset();
  console.log('this browser offset:' + offsetbrowser);
  var diff = (offsetbrowser - offset) / 60;
  var startIndex = 0;
  var endIndex = arrayLength;
  if (startDayAppt >= 0 && endDayAppt >= 0) {
    console.log('YYusing index:' + startDayAppt + ' and end:' + endDayAppt + ' counter:' + counter);
    counter++;
    startIndex = startDayAppt;
    endIndex = endDayAppt;
  }
  console.log('YYstart:' + startIndex + ' and end:' + endIndex);
  for (i = startIndex; i < endIndex; i++) {
    // 6/28/2018 11:00 AM
    console.log('i=' + i + ' got x time:' + apptJSON[i].foreignID);
    if (apptJSON[i].status == 5) {
      continue;
    }
    console.log('got time:' + apptJSON[i].foreignID);
    var checkM = moment.unix(apptJSON[i].foreignID / 1000);
    //var m = moment(apptJSON[i].localStart, 'M/DD/YYYY hh:mm A') ;
    var m = moment(apptJSON[i].localStart, useFormat);
    //console.log("m from localstart:" + m.year()+ ":" + m.month() + ":" + m.date() + ":" + m.hour() ) ;

    //online appts made with old scheduler are a risk...always use absolute time for now...may cause issue with dst
    if (apptJSON[i].type == 1) {
      m = moment.unix(apptJSON[i].foreignID / 1000);
      m = m.add({ hour: diff });
      console.log('found online appt. Using absolute time not local time.');
    } else {
      if (m.hour() != checkM.hour() + diff || m.date() != checkM.date()) {
        m = moment.unix(apptJSON[i].foreignID / 1000);
        console.log(
          'corrected weirdo appt id:' +
            apptJSON[i].posID +
            ' localStart:' +
            apptJSON[i].localStart +
            'lhour:' +
            m.hour() +
            ' ahour:' +
            checkM.hour()
        );
        m = m.add({ hour: diff });
        //console.log("corrected weirdo appt id:" + apptJSON[i].posID + "hour:" + m.hour() + " month:"+ m.month() + " year:" + m.year() + " day:"+m.date()) ;
      } else {
        console.log('found normal appt.  Using local time.');
      }
    }

    console.log(
      'Looking for appts on:' +
        useYear +
        ':' +
        useMonth +
        ':' +
        useDay +
        ' this appt:' +
        m.year() +
        ':' +
        m.month() +
        ':' +
        m.date()
    );
    if (useYear == m.year() && useDay == m.date() && useMonth == m.month()) {
      foundAtLeastOne = true;
      console.log(m.year() + ':' + m.month() + ':' + m.date() + ':' + m.hour());
      if (startDayAppt == -1) {
        console.log('YY found first appt on ' + useDay + ' month:' + useMonth + ' index:' + i);
        startDayAppt = i;
      }
      //console.log("found normal appt id:" + apptJSON[i].posID + " localStart:" + apptJSON[i].localStart + "lhour:" + m.hour() + " ahour:"+ checkM.hour()) ;
      // check if this appointment has any services with the pickedEmployee...but have to iterate to keep the start/end correct
      var bindings = apptJSON[i].serviceBindings;
      var everyone = 0;
      if (apptJSON[i].hasOwnProperty('quicknote')) {
        if (apptJSON[i].quickote != null && apptJSON[i].quicknote.includes('include all')) {
          everyone = 1;
        }
      }
      var len = bindings.length;
      //console.log("got " + len + " bindings");
      var start = Math.floor((m.hour() * 60 + m.minute()) / 5);
      var end = start;
      //console.log("checking appt with start:" + start + " and end" + end) ;
      addNext = true;
      var assigned = '';
      for (var j = 0; j < len; j++) {
        assigned = '';
        // if the appointment is parallel skip the next binding.
        if (addNext) {
          start = end;
          end += ToMinutes(bindings[j].duration) / 5;
          if (jsonMerchant.hasOwnProperty('svcbreak') && jsonMerchant.svcbreak == true) {
            end += ToMinutes(bindings[j].breakDuration) / 5;
          }
        }
        if (bindings[j].hasOwnProperty('assigned')) {
          assigned = bindings[j].assigned;
        }
        if (bindings[j].svcEmployeePOSID == employee.posID || assigned == employee.posID || everyone == 1) {
          //console.log("XXXX got appt at start:" + start * 5 / 60 + "(" + start + ") and end " + end * 5 / 60 + "(" + end + ")");
          var startX = Math.floor(start); // hour
          var endX = Math.ceil(end); // hour
          for (var k = startX; k < endX; k++) {
            timeOffArray[k] = true;
          }
        }
        /* if there was a finish time, account for that... */
        if (bindings[j].hasOwnProperty('finish') && bindings[j].finish > 0) {
          var start2 = end;
          start2 += ToMinutes(bindings[j].breakDuration) / 5;
          var end2 = start2;
          end2 += bindings[j].finish / 5;
          if (bindings[j].svcEmployeePOSID == employee.posID || assigned == employee.posID) {
            //console.log("XXXX got appt at start:" + start * 5 / 60 + "(" + start + ") and end " + end * 5 / 60 + "(" + end + ")");
            var startX = Math.floor(start2); // hour
            var endX = Math.ceil(end2); // hour
            for (var k = startX; k < endX; k++) {
              timeOffArray[k] = true;
            }
          }
        }
        if (bindings[j].isParallel) {
          addNext = false;
          // if parallel, the end of next appt will be the end of this appt.  Needed because previous appt may have had a difft end time
          end = start + ToMinutes(bindings[j].duration) / 5;
        } else {
          addNext = true;
          /* if we haven't added the break time already, do so now so we can accurately calculate the start time of the next service */
          if (bindings[j].hasOwnProperty('finish')) {
            end += ToMinutes(bindings[j].breakDuration) / 5;
            if (bindings[j].finish > 0) {
              end += bindings[j].finish / 5;
            }
          } else {
            if (jsonMerchant.hasOwnProperty('svcbreak') && jsonMerchant.svcbreak == true) {
              continue;
            }
            end += ToMinutes(bindings[j].breakDuration) / 5;
          }
        }
      }
    } else {
      if (startDayAppt >= 0 && endDayAppt < 0) {
        // we had a start date
        console.log('YYfound last appt on ' + useDay + ' month:' + useMonth + ' index:' + i);
        if (foundAtLeastOne) {
          endDayAppt = i;
          break;
        }
        //break ;
      }
    }
  }
  if (startDayAppt < 0) {
    // means no appointments were found for this date
    startDayAppt = 0;
    endDayAppt = 0;
  }

  // find runs of totalDuration/5 length...
  var runLength = totalDuration / 5;
  var runGood = true;
  var interval = ToMinutes(jsonMerchant.hourIncrements) / 5;
  if (jsonMerchant.onlineIncrements != null) {
    interval = ToMinutes(jsonMerchant.onlineIncrements) / 5;
  }
  console.log(
    'totalduration:' + runLength + ' interval:' + interval + ' looking for:' + runLength + ' duration:' + totalDuration
  );
  var slots = 0;
  var timestring = '';
  var first = 1;
  var realhours;
  for (i = 0; i < 350; i += interval) {
    //console.log(i + " status of:"+ (i * 5/60) + "is: " + timeOffArray[i]) ;
    for (var j = 0; j < runLength; j++) {
      if (timeOffArray[i + j] == true) {
        //console.log("failed run:"+((i+j)*5/60)+". needed:"+runLength+ " but got:"+j) ;
        runGood = false;
        break;
      }
      //console.log("is good:"+((i+j)*5/60)) ;
    }
    if (runGood) {
      slots++;
      var min = i * 5; // 480
      var hh = Math.floor(min / 60); // hour
      var mm = min % 60;
      var ampm = ' am';
      if (hh > 12) {
        hh -= 12;
        ampm = ' pm';
      }
      if (hh == 12) {
        ampm = ' pm';
      }
      if (hh == 0) {
        hh = 12;
        ampm = ' am';
      }
      // don't allow booking pre 6 am to handle a bug with the time on/off that seems make wild, early slots available
      if (hh < 6 && ampm == ' am') {
        continue;
      }
      if (first == 1) {
        first = 0;
        if (ampm == ' pm' && hh != 12) {
          realhours = hh + 12;
        } else {
          realhours = hh;
        }
        console.log('Foundx earliest time hour ' + hh + ' this one is:' + (realhours * 60 + mm));
        if (realhours * 60 + mm < earliestEmployeeTime) {
          earliestEmployeeTime = realhours * 60 + mm;
          earliestEmployeeNumber = z;
          console.log('Foundx earliest time = ' + earliestEmployeeTime + ' number=' + earliestEmployeeNumber);
        }
      }
      //console.log("added to time string:" + hh + ":" + pad2(mm)) ;
      timestring = timestring + hh + ':' + pad2(mm) + ampm + '~' + min + '###';
    }
    runGood = true;
  }
  // if we got here then we don't have a good run for this employee for the days (not including the actually selected date which is zzz = -1
  console.log('Got time options for employee ' + z + ' = ' + timestring);
  employeeTimeString[z] = timestring;
}

// =====================================================================================
// ===== END VERBATIM LIFT =============================================================
// =====================================================================================

/**
 * Adapted from FillEmployeesAndTimeSlots (cbbe2.js:2882-2918), DOM removed.
 * Returns { offersAll, durationMin } for `employeeIndex` doing `selectedServiceIndexes`.
 *
 * Difference from the original loose loop: we require that EVERY requested service has a
 * matching serviceCfg that is offered + offeredOnline. The website pre-filters the service
 * dropdown per employee so it never hits the "service missing entirely" case; we check all
 * employees against an arbitrary requested service, so we must exclude employees who simply
 * don't offer it (same semantics as DoesPickedEmployeeOfferThisService, cbbe2.js:2709).
 */
function computeEmployeeDuration(employeeIndex, selectedServiceIndexes) {
  const emp = employeeJSON[employeeIndex];
  const cfgs = (emp && emp.serviceCfgs) || [];
  let durationMin = 0;
  for (const idx of selectedServiceIndexes) {
    const svc = serviceJSON[idx];
    if (!svc) return { offersAll: false, durationMin: 0 };
    let matched = false;
    for (const serviceObj of cfgs) {
      if (serviceObj.posID === svc.posID) {
        if (!serviceObj.offeredOnline || !serviceObj.offered) {
          return { offersAll: false, durationMin: 0 };
        }
        durationMin += ToMinutes(serviceObj.duration);
        durationMin += ToMinutes(serviceObj.breakDuration);
        if (Object.prototype.hasOwnProperty.call(serviceObj, 'finish')) {
          durationMin += serviceObj.finish;
        }
        matched = true;
        break;
      }
    }
    if (!matched) return { offersAll: false, durationMin: 0 };
  }
  return { offersAll: true, durationMin };
}

// Parse the "h:mm am~minutesIntoDay###..." string FillTimeArray writes into real times.
function parseTimeString(s, year, month0, day) {
  const out = [];
  if (!s) return out;
  const mm = String(month0 + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const base = moment.tz(`${year}-${mm}-${dd} 00:00`, 'YYYY-MM-DD HH:mm', salonTz);
  for (const chunk of s.split('###')) {
    if (!chunk) continue;
    const parts = chunk.split('~');
    if (parts.length < 2) continue;
    const minutesIntoDay = parseInt(parts[1], 10);
    if (Number.isNaN(minutesIntoDay)) continue;
    const m = base.clone().add(minutesIntoDay, 'minutes');
    out.push({
      minutesIntoDay,
      label: m.format('h:mm A'),
      hst: m.format('YYYY-MM-DD HH:mm'),
      iso: m.toISOString(true), // ISO 8601 with the salon's -10:00 offset
    });
  }
  return out;
}

/**
 * Compute open slots for a date.
 *
 * @param {object}   p
 * @param {object[]} p.apptJSON               booked appointments (from getBookedAppointments)
 * @param {number}   p.year
 * @param {number}   p.month0                 0-indexed month (moment convention)
 * @param {number}   p.day
 * @param {?number}  p.employeeIndex          specific stylist, or null for all stylists
 * @param {number[]} p.selectedServiceIndexes serviceJSON indexes for the requested service(s)
 * @returns {{employeeIndex:number,durationMin:number,slots:object[]}[]}
 */
function computeAvailability({ apptJSON: appts, year, month0, day, employeeIndex, selectedServiceIndexes }) {
  // reset per-call state mirroring cbbe2 globals
  thisDateYear = year;
  thisDateMonth = month0;
  thisDateDay = day;
  const mm = String(month0 + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  startDate = moment.tz(`${year}-${mm}-${dd} 00:00`, 'YYYY-MM-DD HH:mm', salonTz);
  thisDate = startDate.format();
  apptJSON = appts || [];
  offsetdiff = 0;
  counter = 0;
  earliestEmployeeTime = 9000;
  earliestEmployeeNumber = -1;
  employeeTimeString = [];

  const indexes =
    employeeIndex == null ? employeeJSON.map((_, i) => i) : [employeeIndex];

  const results = [];
  for (const i of indexes) {
    const emp = employeeJSON[i];
    if (!emp) continue;
    // mirror LoadEmployees filtering: hidden-online (type 1) or non-online employees are not bookable
    if (emp.type === 1 || !emp.performsOnlineServices) continue;

    const { offersAll, durationMin } = computeEmployeeDuration(i, selectedServiceIndexes);
    if (!offersAll || durationMin <= 0) continue;

    // Reset the day-slice cache before each employee so every employee gets a full,
    // independent scan of apptJSON (safe regardless of appointment ordering).
    startDayAppt = -1;
    endDayAppt = -1;

    FillTimeArray(i, durationMin); // writes employeeTimeString[i]
    const slots = parseTimeString(employeeTimeString[i] || '', year, month0, day);
    if (slots.length) results.push({ employeeIndex: i, durationMin, slots });
  }
  return results;
}

module.exports = { configure, computeAvailability, ToMinutes };
