var lastDate = 0;
var lastMonth = 0;
var lastDuration = 0;
var counter = 0;
var clover;
var elements;
var infogood = 0;
var cloverChargeToken;
var errorstring = "";
var offsetdiff = 0;
var haveCaptcha = 0 ;

const styles = {
    'card-number input': {
        'padding': '10px',
        'height': '3em',
        'width': '100%',
        'background-color': '#DDDDDD'
    },
    'card-date input': {
        'padding': '10px',
        'height': '3em',
        'width': '100%',
        'background-color': '#DDDDDD',
    },
    'card-cvv input': {
        'padding': '10px',
        'height': '3em',
        'width': '100%',
        'background-color': '#DDDDDD',
    },
    'card-postal-code input': {
        'padding': '10px',
        'background-color': '#DDDDDD',
        'width': '100%',
        'height': '3em',
    }
};

// this the array of selected service indexes
var bookingStarted = 0;
var startDate;
var startSessionTime;
var returnvalue = 0;
var selectedServices = [];
var selectedServicesDuration = 0;
var employeeTimeString = [];
var earliestEmployeeTime;
var earliestEmployeeNumber;

var orgselectedServices = [];
var orgAddOns = [];
var addongroups = "";

var startDayAppt = -1;
var endDayAppt = -1;

var servicePicked = false;
var employeePicked = false;
var timePicked = false;
var datePicked = false;
var pickedEmployee = -1;
var chargeAmount = 0;
var tipAmount = 0;
var employeeCalled = "";

var thisDate = "";
var thisDateMoment;
var thisDateYear;
var thisDateMonth;
var thisDateDay;
var thisTime = 0;
// unused but may be important
var pricing = true;

var localFormat = 'M/DD/YYYY hh:mm A';
var localFormatView = 'M/DD/YYYY h:mm A';
var calendarFormat = 'yy-mm-dd';
var localFormat2 = 'D/MM/YYYY hh:mm A';
var localFormat2View = 'D/MM/YYYY h:mm A';
var calendarFormat2 = 'yy-dd-mm';

var useFormat = '';
var useFormatView = '';

var currency = "$";
var idleTime;
var maxIdleTime = 0;
var specialFeature = 0;

var mymin = moment().startOf('day'); // with object literal
if (monthsx > 12) {
    var mymax = moment().add({ days: monthsx, months: 0 }); // with object literal
}
/*
else if (monthsx == 0) {
    var mymax = moment().add({ hours: 12, months: 0 }); // with object literal
}
*/
else {
    var mymax = moment().add({ days: 0, months: monthsx }); // with object literal
}
var lastApptDate = mymin; // with object literal

if (merchantId == 'PE216Y6TA47Z1') {
    mymax = moment().add({ days: 0, weeks: 2 }); // with object literal
}

var orgPickedDate = mymin;

if (advance >= 24) {
    var dayadvance = advance / 24;
    mymin = moment().startOf('day').add({ days: dayadvance }); // with object literal
    console.log("day advance:" + dayadvance);
    console.log(mymin.format('ll'));
}

/*
if (advance >= 48) {
    mymin = moment().startOf('day').add({ days: 2 }); // with object literal
    console.log(mymin.format('ll'));
}
else if (advance >= 24) {
    mymin = moment().startOf('day').add({ days: 1 }); // with object literal
    console.log(mymin.format('ll'));
}
*/
if (merchantId == 'HH340ECRNKT71') {
    console.log("using late start date feature");
    mymin = moment().startOf('day').add({ days: 7 }); // with object literal
    console.log(mymin.format('ll'));
}
else if (merchantId == 'E29HN16AK7XH1') {
    mymin = new moment("May 04 2022", 'MMM DD YYYY');
}
else if (merchantId == '0FMZ3SR0QSNE1') {
    if (employeeJSON.length == 1) {
        if (employeeJSON[0].posID == '170EWE1YDAJP0' || employeeJSON[0].posID == '92KZ186YE24AP') {
            employeeJSON[0].performsOnlineServices = true;
        }
    }
}
//if (merchantId == '6RTGHZBW08G61') {
//}
var features = 0;
var sxday;
var sxtime = 0;
var extime = 0;
var sxtime2 = 0;
var extime2 = 0;
var exday;
if (merchantId == 'T3HV9H3N8JA91') {
    features = 1;
    sxday = new Date(mymin.local().year(), 10, 25); // zero based month...this is nov!
    sxtime = sxday.getTime();
    exday = new Date(mymin.local().year(), 10, 28);
    extime = exday.getTime();
}
else if (merchantId == 'GQSE3BY14CEJ1') {
    features = 1;
    sxday = new Date(mymin.local().year(), 10, 25); // zero based month...this is nov!
    sxtime = sxday.getTime();
    exday = new Date(mymin.local().year(), 10, 25, 23, 59, 0);
    extime = exday.getTime();

    sxday = new Date(mymin.local().year(), 10, 21); // zero based month...this is nov!
    sxtime2 = sxday.getTime();
    exday = new Date(mymin.local().year(), 10, 22, 23, 59, 0);
    extime2 = exday.getTime();
}
if (merchantId == '37AGCSNGZGCC1') {
    var xhr = moment().hour();
    var xadv = 1;
    console.log("current hour:" + xhr);
    if (xhr > 17) {
        xadv = 2;
    }
    mymin = moment().startOf('day').add({ days: xadv }); // with object literal
    console.log(mymin.format('ll'));
}
else if (merchantId == 'JCN67ETGR50R1') {
    console.log("using stop date feature");
    mymax = moment().add({ days: 2 }); // with object literal
    console.log(mymax.format('ll'));
}
/*
if (merchantId == '9X4H4577KZFJ1') {
    console.log("using delayed date feature");
    mymin = moment("08-10-2020", "MM-DD-YYYY");
    console.log(mymin.format('ll'));
}
else if (merchantId == '6XK3BP5S4S2T1') {
    console.log("using stop date feature");
    mymax = moment("08-31-2020", "MM-DD-YYYY");
    console.log(mymax.format('ll'));
}
else if (merchantId == 'ZY2HGYM0QA781') {
    console.log("using delayed date feature");
    mymin = moment("05-03-2021", "MM-DD-YYYY");
    console.log(mymin.format('ll'));
}
else if (merchantId == 'PXSKMMAPF36S1') {
    console.log("using delayed date feature");
    mymin = moment("05-01-2021", "MM-DD-YYYY");
    console.log(mymin.format('ll'));
}
*/

timezoneJS.timezone.zoneFileBasePath = 'tz';
timezoneJS.timezone.init({ callback: null });
var serviceText = document.getElementById("serviceText");
M.AutoInit();

var activeDate = [];

// add all holidays
var hollen = holidays.length;
var i = 0;
for (i = 0; i < hollen; i++) {
    var date = new Date(holidays[i] * 1000);
    activeDate[date] = 1;
}

var lastActiveDate;

var options = {
    autoClose: true,
    dateFormat: calendarFormat,
    //defaultDate: new Date(mymin.local().year(), mymin.local().month(), mymin.local().date()),
    setDefaultDate: false,
    minDate: new Date(mymin.local().year(), mymin.local().month(), mymin.local().date()),
    maxDate: new Date(mymax.local().year(), mymax.local().month(), mymax.local().date()),
    showDaysInNextAndPreviousMonths: false,
    //     disableDayFn: disabledays,
    onSelect: datepicked,
    disableDayFn: function (date) {
        if (features == 1) {
            var dtime = date.getTime();
            if (dtime >= sxtime && dtime <= extime || (dtime >= sxtime2 && dtime <= extime2)) {
                //console.log("blocking:" + date.getTime() + " checked:" + sxtime + " and " + extime) ;
                return true;
            }
        }
        if (activeDate[date] == 1 || activeDate[date] == 0) {
            console.log("calling buffer:" + date);
            return activeDate[date];
        }
        console.log("calling :" + date);
        setDate(date);
        var rev = FillEmployeesAndTimeSlots(0);
        if (rev <= 0) {
            activeDate[date] = 1;
            return true;
        }
        activeDate[date] = 0;
        return false;
    }
}

var elems = document.querySelector('.datepicker');
var instance = M.Datepicker.init(elems, options);

async function getappointments(startdateSecs, numdays) {
    // jvp get start unix time, end unix time, and get apptJSON by parsing the response....if failed or ERROR, then DO NOT show any
    // slots available
    console.log("unixstart:" + startdateSecs + " for " + numdays + " for " + merchantId);
    var url = "https://reports.appheaven.us/online/getappt.php";
    await $.post(url,
        {
            start: startdateSecs, end: (startdateSecs + (86400000 * numdays)), merchantid: merchantId
        })
        .done(function (data, status) {
            if (data == "ERROR") {
                Swal.fire({
                    title: 'Error!',
                    text: 'Internet problem. Please try date again.',
                    showCancelButton: true,
                    icon: 'error',
                    confirmButtonText: 'Ok, thanks!',
                    denyButtonText: 'Cancel',
                }).then((result) => {
                    /* Read more about isConfirmed, isDenied below */
                    if (result.isConfirmed) {
                        Reset();
                        location.reload(true);
                    } else if (result.isDenied) {
                        Reset();
                        location.reload(true);
                    }
                });
            }
            // create apptJSON array with returned results...
            else {
                var appts = data.split("||");
                if (appts.length > 0) {
                    // create json
                    //apptJSON.length = 0;
                    for (var x = 0; x < appts.length; x++) {
                        if (appts[x].length > 0) {
                            //console.log("got appt:" + appts[x]);
                            if (merchantId == 'B29AMCHM83W6G') {  // remove extraneous backslash from the appts for javascript to parse them correctly
                                appts[x] = appts[x].replace(/\\/g, "\\\\");
                            }
                            apptJSON.push(JSON.parse(appts[x]));
                        }
                    }
                }
            }
        }); // end of .done
}

function setDate(e) {
    if (e != null) {
        var mstring = e.toString().split("GMT");
        var thisstring = mstring[0] + mstring[1];
        console.log("date returned:" + e);
        //console.log("date returned:" + thisstring);
        startDate = new moment(thisstring, 'ddd MMM DD YYYY HH:mm:ss ZZ');
        //if (startDate.date() == lastDate && startDate.month() == lastMonth) {
        //return; // selected same day/month again
        //}
    }
    else {
        startDate = mymin;
    }
    lastDate = startDate.date();
    lastMonth = startDate.month();
    //need to minus 720 minutes for this calendar which returns 12:00
    thisDateMoment = startDate.clone();
    thisDate = startDate.format();
    thisDateYear = thisDateMoment.year();
    thisDateMonth = thisDateMoment.month();
    thisDateDay = thisDateMoment.date();
}

function CreateAddOnOption(j) {
    console.log("including add on:" + serviceJSON[j].name);
    details = currency + ((serviceJSON[j].price) / 100.0).toFixed(2);
    data = { id: j, text: serviceJSON[j].name.replace("_", "'") + "::" + details + " | Add on service ::" };
    var newOption = new Option(data.text, j, false, false);
    console.log("display opt option:" + data.text + " value:" + j);
    $('.addons').append(newOption);
}


async function datepicked(e) {
    //startDate = start.clone();
    // Mon Apr 08 2019 00:00:00 GMT-0500 (Central Daylight Time)
    datePicked = true;
    console.log("picked: " + thisDateYear + ":" + thisDateMonth + ":" + thisDateDay + ":" + thisDateMoment.local().hour() + " thisDate:" + thisDate);
    setDate(e);
    /*
        if (e != null) {
            var mstring = e.toString().split("GMT");
            var thisstring = mstring[0] + mstring[1];
            console.log("date returned:" + e);
            console.log("date returned:" + thisstring);
            startDate = new moment(thisstring, 'ddd MMM DD YYYY HH:mm:ss ZZ');
            datePicked = true;
            if (startDate.date() == lastDate && startDate.month() == lastMonth) {
                return; // selected same day/month again
            }
        }
        else {
            startDate = mymin;
        }
        lastDate = startDate.date();
        lastMonth = startDate.month();
        //need to minus 720 minutes for this calendar which returns 12:00
        thisDateMoment = startDate.clone();
        thisDate = startDate.format();
        thisDateYear = thisDateMoment.year();
        thisDateMonth = thisDateMoment.month();
        thisDateDay = thisDateMoment.date();
    */
    console.log("picked: " + thisDateYear + ":" + thisDateMonth + ":" + thisDateDay + ":" + thisDateMoment.local().hour() + " thisDate:" + thisDate);
    if (!servicePicked) {
        Swal.fire({
            title: 'Attention!',
            icon: "warning",
            text: 'Please select your services first so we can present days that are available.',
            confirmButtonText: 'OK, thanks!',
            showConfirmButton: true,
        });
        return;
    }
    // jvp get start unix time, end unix time, and get apptJSON by parsing the response....if failed or ERROR, then DO NOT show any
    // slots available
    //console.log("unixstart:" + startDate.unix());
    await getappointments(startDate.unix() * 1000, 2);
    var rev = FillEmployeesAndTimeSlots(1);
    if (rev == 0) {
        //instance.close();
        Swal.fire({
            title: 'Selected date/time not available for this employee',
            text: 'Selected date not available with this employee. Please select another date or choose another employee.',
            showDenyButton: false,
            showCancelButton: false,
            confirmButtonText: 'Ok, thanks!',
        });
        var i;
        var nextday;
        nextday = new Date(e.getFullYear(), e.getMonth(), 1);
        var max = 38;
        //if (merchantId == '6RTGHZBW08G61') {
        //max = 200 ;
        //}
        await getappointments(nextday.getTime(), max);
        for (i = 1; i < max; i++) {
            nextday = new Date(e.getFullYear(), e.getMonth(), 1 + i);
            activeDate[nextday] = 2;
        }
    }
    /*
           if (orgPickedDate != null) {
              setDate(orgPickedDate) ;
              rev = FillEmployeesAndTimeSlots(1);
              if (rev  != 0) {
                  instance.setDate(startDate) ;
                  instance.close();
              }
           }
        }
        else {
            orgPickedDate = e ;
        }
    */
};

function toUnique(a, b, c) { //array,placeholder,placeholder
    b = a.length;
    while (c = --b)
        while (c--) a[b] !== a[c] || a.splice(c, 1);
    return a // not needed ;)
}

function sortByProperty(property) {
    return function (a, b) {
        if (a[property] > b[property])
            return 1;
        else if (a[property] < b[property])
            return -1;

        return 0;
    }
}

function NewLoadServices() {
    if (!employeePicked) {
        return;
    }
    var activeCount = 0;
    var alphaCat = [];
    console.log("Loading Services...");
    //OldLoadServices() ;
    // blank everything
    $(".services").empty();
    serviceDuration = 0;
    servicePicked = false;

    arrayLength = serviceJSON.length;
    serviceJSON.sort(sortByProperty("rank"));
    var tempCat = serviceCat;
    var groupArray = [];

    // first split any multiple groups...so I have an array of all of the possible group names
    var count = 0;
    var newstr = "Services";
    for (i = 0; i < arrayLength; i++) {
        //console.log("item:" + serviceJSON[i].name);
        // only count services that are offered online
        if (DoesPickedEmployeeOfferThisService(serviceJSON[i].posID) <= 0) {
            console.log("offers:false");
            serviceJSON[i].empoffers = false;
            continue;
        }
        console.log("offers:true");
        serviceJSON[i].empoffers = true;
        // if the cat is service,another service then add a new tempCat entry as a "phantom" category
        var cat = tempCat[serviceJSON[i].posID];
        if (cat == null) {
            cat = "Services";
        }
        var allgroups = cat.split(",");
        if (allgroups.length >= 1) {
            for (var j = 0; j < allgroups.length; j++) {
                // replace any leading ' '
                newstr = allgroups[j].replace(allgroups[j].match(/^ /), "");
                groupArray[count++] = newstr;
                console.log("adding:" + newstr);
            }
        }
    }
    groupArray[count++] = "Services";
    console.log("adding:" + newstr);
    // make unique and alphabetize the group names (these group names still have their numbers on them)
    toUnique(groupArray);
    groupArray.sort();

    if (count <= 0) {
        var newOption = new Option("No employees offer services online", 0, false, false);
        //console.log("text:" + data.text + " index:" + j) ;
        console.log("No employees offer services. Please contact the Salon");
        $('.services').append(newOption);
        $('select:not(.swal2-select)').formSelect();
        return;
    }
    var xtra = 0;
    if (merchantId == 'C419P0RX04EW1') { // reverse order
        groupArray.sort().reverse();
    }
    else if (merchantId == 'SJ8AGN7G39101') { // southern roots wants "Starting at" before the price
        xtra = 1;
    }
    // now loop through the categores...I need the cat
    for (i = 0; i < groupArray.length; i++) {
        // if the group label has '00 which is a 2 digit number, then replace with '.  the number was just to alphabetize...
        var cat = groupArray[i].replace(groupArray[i].match(/^[0-9][0-9]/), "");
        // replace a beginning space if needed
        cat = cat.replace(cat.match(/^ /), "");
        // if invisible, skip it
        if (cat == "INVISIBLE" || cat == "Invisible" || cat == "invisible") {
            continue;
        }
        // first print the group label
        var groupname = "<optgroup label='" + cat + "'>"; // make it look the same so we can easily match using ==
        //$('.services').append(alphaCat[i]);
        console.log("display opt category:" + groupname);
        // next look through all of the services and add the ones that indicate this group 
        var grouplabel = false;
        for (j = 0; j < arrayLength; j++) {
            if (serviceJSON[j].empoffers == false) {
                console.log("skipping not offered:" + serviceJSON[j].name);
                continue;
            }
            // skip the service if its invisible
            if (serviceJSON[j].invisible != null) {
                if (serviceJSON[j].invisible == true) {
                    console.log("skipping invisible:" + serviceJSON[j].name);
                    continue;
                }
            }
            // first check if we have it from the php search for files, etc
            var servicecat = tempCat[serviceJSON[j].posID];
            console.log("checking cat:" + servicecat);
            if (servicecat == null) {
                servicecat = "Services";
            }
            // next, break down the service into multiple groups if multiple groups are specified
            var allgroups = servicecat.split(",");

            var found = false;
            for (var ji = 0; ji < allgroups.length; ji++) {
                var newstr = allgroups[ji].replace(allgroups[ji].match(/^ /), "");
                // now remove the leading numbers
                var newstr = newstr.replace(newstr.match(/^[0-9][0-9]/), "");
                // now remove any leading space
                newstr = newstr.replace(newstr.match(/^ /), "");
                // add item to this group heading...
                if (newstr == cat) {
                    if (grouplabel == false) {
                        grouplabel = true;
                        $('.services').append(groupname);
                    }
                    found = true;
                    AddOption(j, xtra);
                }
            }
        }
        // next add the group close
        if (grouplabel) {
            $('.services').append("</optgroup>");
        }
    }
    $('select:not(.swal2-select)').formSelect();
}

function AddOption(j, xtra) {
    var data = "Item";
    // calculate the details (price and duration)
    var details = "";
    var price = serviceJSON[j].priceType;
    if (price == 1) { // fixed price
        details = currency + ((serviceJSON[j].price) / 100.0).toFixed(2);
        if (xtra == 1) {
            details = "Starting at " + currency + ((serviceJSON[j].price) / 100.0).toFixed(2);
        }
        if (merchantId == 'JMMHPWM8B00W1' || merchantId == 'BQMN8CW3TKYW1' || merchantId == 'HM831G4DDC2X1') {
            details = "Contact for pricing";
        }
    }
    else if (price == 2) { // variable price
        // if variable priced, we need to check the value of varprice for each employee for this service and create a low to hi or a low+....
        var eLength = employeeJSON.length;
        var thismax = 0;
        var thismin = 9999999999;
        for (var h = 0; h < eLength; h++) {
            // does the employee perform online?
            if (!employeeJSON[h].performsOnlineServices) {
                continue;
            }
            // find the min/max based on the employee services
            var length = employeeJSON[h].serviceCfgs.length;
            //console.log("Found " + length + " services");
            for (var k = 0; k < length; k++) {
                //console.log("checking " + k + " Service");
                var serviceObj = employeeJSON[h].serviceCfgs[k];
                if (serviceObj.posID == serviceJSON[j].posID) {
                    if (serviceObj.varprice < thismin) {
                        thismin = serviceObj.varprice;
                    }
                    if (serviceObj.varprice > thismax) {
                        thismax = serviceObj.varprice;
                    }
                    break;
                }
            }
            // now, adjust the min max based on the services varprice defaults
            if (serviceJSON[j].varprice > thismax) {
                thismax = serviceJSON[j].varprice;
            }
            if (serviceJSON[j].varprice < thismin) {
                thismin = serviceJSON[j].varprice;
            }
        }
        //console.log("thismin:" + thismin + " thismax:" + thismax) ;
        if (thismax == 0 && thismin == 0) {
            details = "Price Varies";
        }
        else if (thismax == 0 && thismin > 0 && thismin < 999999999) {
            details = "Price Starting At " + currency + (thismin / 100.0).toFixed(2);
        }
        else if (thismin == 0 && thismax > 0) {
            details = "Price Varies Up To " + currency + (thismax / 100.0).toFixed(2);
        }
        else if (thismax > 0 && thismin > 0 && thismax > thismin) {
            details = "Prices From " + currency + (thismin / 100.0).toFixed(2) + " to " + currency + (thismax / 100.0).toFixed(2);
        }
        else if (thismax > 0 && thismax > thismin) { // have a max but no min...just one number
            details = "Prices Varies Approx " + currency + (thismax / 100.0).toFixed(2);
        }
        else {
            details = "Price Varies";
        }
        if (merchantId == 'G15JVTGJ809K1') {
            if (details.includes("Price")) {
                details = "See pricing below";
            }
        }
    }
    else { // unknown...no price
        details = "Contact for pricing";
    }
    // calculate the duration....either X min or X min | Y break | Z finish

    var dur = ToMinutes(serviceJSON[j].duration);
    if (dur == 0) {
        return;
    }
    var brk = ToMinutes(serviceJSON[j].breakDuration);
    if (jsonMerchant.hasOwnProperty('svcbreak') && jsonMerchant.svcbreak == true) {
        brk = 0;
    }
    var thisdur = "";
    var durstring = "";
    var totdur = 0;
    if (serviceJSON[j].hasOwnProperty('finish')) {
        totdur = dur + brk + serviceJSON[j].finish;
    }
    else {
        totdur = dur + brk;
    }

    // if employee picked, find the duration/break/finish for that particular employee 
    if (pickedEmployee >= 0) {
        var length = employeeJSON[pickedEmployee].serviceCfgs.length;
        for (var k = 0; k < length; k++) {
            var serviceObj = employeeJSON[pickedEmployee].serviceCfgs[k];
            if (serviceObj.posID == serviceJSON[j].posID) {
                dur = ToMinutes(serviceObj.duration);
                brk = ToMinutes(serviceObj.breakDuration);
                if (serviceObj.hasOwnProperty('finish')) {
                    totdur = dur + brk + serviceObj.finish;
                }
                else {
                    totdur = dur + brk;
                }
                break;
            }
        }
    }

    if (totdur % 60 == 0) {
        if (totdur == 60) {
            durstring = totdur / 60.0 + " hour";
        }
        else {
            durstring = totdur / 60.0 + " hours";
        }
    }
    else {
        if (totdur < 60) {
            durstring = totdur + " minutes";
        }
        else {
            durstring = totdur + " minutes";
        }
    }
    if (serviceJSON[j].hasOwnProperty('finish')) {
        if (serviceJSON[j].finish > 0) {
            thisdur = durstring + " (Treat: " + dur + " | Hold: " + brk + " | Finish: " + serviceJSON[j].finish + " min)";
        }
        else if (brk > 0) {
            thisdur = durstring + " (Treat: " + dur + " | Hold: " + brk + " min)";
        }
        else {
            thisdur = durstring;
        }
    }
    else if (brk > 0) {
        thisdur = "Treat: " + durstring + " | Hold: " + brk + " min";
    }
    else { // no finish property...just normal way of handling duration
        thisdur = durstring;
    }
    if (merchantId == '87XNTMR5GE381' || merchantId == 'MS84DFH5W6WM1') {
        thisdur = "";
    }
    // make the detail string 
    details = "::" + details + " | " + thisdur;
    // add the description if there is one that is relevant
    if (merchantId == 'JCN67ETGR50R1') {
        details = "";
    }
    else if (merchantId == 'SC4RBBPJ5KKX1') {
        details = "";
    }
    else if (merchantId == 'V8H78GWVQE361') {
        details = "";
    }
    else if (merchantId == 'PXHK1S2SQB0T1') {
        details = "";
    }
    else if (merchantId == 'ME04JC3GEXDW1') {
        thisdur = "";
    }
    else if (merchantId == '6ZP21FDYY3TB1') {
        thisdur = "";
    }
    var usedesc = false;
    if (serviceJSON[j].description == "WHITESPACE") {
        serviceJSON[j].description = "no description";
    }
    if (serviceJSON[j].description != serviceJSON[j].name && serviceJSON[j].description.length != serviceJSON[j].name.length && serviceJSON[j].description != 'no description') {
        console.log("display description:" + serviceJSON[j].description);
        details = details + "::" + serviceJSON[j].description;
        usedesc = true;
        if (merchantId == 'V3QG8XQN3Z2KG') {
            usedesc = false;
        }
    }
    else {
        details = details + "::" + "";
    }
    // add the hold amounts to the description iff new hold usage 
    if (prepay) {
        var foundhold = false;
        var tag = " no show fee/deposit" ;
        if (merchantId == '2WH8EYNE4MF01') {
            tag = " non refundable deposit" ;
        }
        if (serviceJSON[j].hasOwnProperty('hold') && serviceJSON[j].hasOwnProperty('holdtype')) {
            var holdstr = "";
            if (serviceJSON[j].hold > 0) {
                if (serviceJSON[j].holdtype == 2) {
                    holdstr = currency + "$" + serviceJSON[j].hold + tag;
                    foundhold = true;
                }
                else {
                    holdstr = serviceJSON[j].hold + "%" + tag;
                    foundhold = true;
                }
                if (usedesc) {
                    details = details + " | " + holdstr;
                }
                else {
                    details = details + holdstr;
                }
            } // if hold is zero, check for a global hold amount....
        }
        console.log("foundhold = " + foundhold + " damt=" + jsonMerchant.damt);
        if (foundhold == false && jsonMerchant.damt != null) {
            if (jsonMerchant.damt > 0) { // it's a percent
                holdstr = jsonMerchant.damt + "%" + tag;
            }
            else if (jsonMerchant.damt < 0) {
                var xamt = jsonMerchant.damt * -1;
                if (xamt > (serviceJSON[j].price / 100.0) && serviceJSON[j].price > 0) {
                    xamt = serviceJSON[j].price / 100.0;
                }
                console.log("xamt:" + xamt);
                holdstr = currency + xamt + tag;
            }
            if (merchantId == 'C419P0RX04EW1' || merchantId == 'PFKEX1PYRCKZ1' || merchantId == 'RAKAJAVAT7751') {
                holdstr = "";
            }
            if (usedesc) {
                details = details + " | " + holdstr;
            }
            else {
                details = details + holdstr;
            }
        }
    }
    if (details == "::") {
        details = "";
    }

    data = { id: j, text: serviceJSON[j].name.replace("_", "'") + details };

    var newOption = new Option(data.text, j, false, false);
    console.log("display opt option:" + data.text + " value:" + j);
    $('.services').append(newOption);
}

$(document).ready(function () {
    startSessionTime = new Date().getTime();
    idleInterval = setInterval(timerIncrement, 60000); // 1 minute
    employeeJSON.sort(sortByProperty("rank"));

    var prev = localStorage.getItem('lastAppt' + merchantId);
    var hasPrevious = false;
    console.log("prev appt:" + prev);
    showAddOns(false);
    //Zero the idle timer on mouse movement.
    $('body').mousemove(function (e) {
        idleTime = 0;
    });
    $('body').keypress(function (e) {
        idleTime = 0;
    });
    $('body').click(function () {
        idleTime = 0;
    });
    maxIdleTime = 0;
    if (jsonMerchant.defaultCurrency != "USD") {
        currency = "";
    }
    if (jsonMerchant.timezone == "EST") {
        jsonMerchant.timezone = "America/New_York";
    }
    else if (jsonMerchant.timezone == "CST") {
        jsonMerchant.timezone = "America/Chicago";
    }
    if (jsonMerchant.timezone.includes("Europe")) {
        useFormat = localFormat2;
        useFormatView = localFormat2View;
    }
    else {
        useFormat = localFormat;
        useFormatView = localFormatView;
    }
    if (merchantId == 'WQ26204B100W1') {
        document.getElementById("tech-name").innerHTML = "4. Select Pod";
        employeeCalled = " Pods";
    }
    else if (merchantId == 'ZY2HGYM0QA781') {
        document.getElementById('services').removeAttribute("multiple");;
        document.getElementById("services").selectedIndex = -1;
    }
    else if (merchantId == '6ZP21FDYY3TB1') {
        employeeCalled = " Your Boat";
        document.getElementById("service-label").innerHTML = "Select Your Package";
        document.getElementById("tech-name").innerHTML = "<font style=\"color: #000000;\">Select Your Boat (They are the exact same boat. If time not available, select boat 2)";
    }
    else if (merchantId == '8SSW5MZRZZ331') {
        document.getElementById("tech-name").innerHTML = "<font style=\"color: #1E1000;\">Select Team Member";
        document.getElementById("time-label").innerHTML = "<font style=\"color: #1E1000;\">Select Time";
        document.getElementById("service-label").innerHTML = "<font style=\"color: #1E1000;\">Select Service(s)";
        //document.getElementById("datepicker").innerHTML = "<font style=\"color: #1E1000;\">Pick Date (Tap line)";
        serviceText.backgroundColor = "#1e1000";
    }
    else if (merchantId == '744JAJRN44R81') {
        document.getElementById("service-label").innerHTML = "Select Number of Classes";
        document.getElementById("tech-name").innerHTML = "Select Blow Hole";
        employeeCalled = " Blow Hole";
    }
    else if (merchantId == 'QMXJZBW2MK3D1') {
        document.getElementById("service-label").innerHTML = "Select Services";
        document.getElementById("tech-name").innerHTML = "Select Treatment Room";
        document.getElementById("note-label").innerHTML = "Preferred Therapist | Notes for Therapist";
        serviceText.innerHTML = "<a href=\"https://reports.appheaven.us/online/tcbbe.php?merchantid=" + merchantId + "&force=1\" style=\"color: #ffffff;padding:10px\";><center>Please select a service or tap here to select treatment room first.</center></a>";
        employeeCalled = " Treatment Room";
    }
    else if (merchantId == '1K4RDS78JHQAE' || merchantId == '3KS5T367F5BV1' || merchantId == 'DSTHHVR2AYB01') {
        document.getElementById("tech-name").innerHTML = "<font style=\"color: #000000;\">Select Team Member";
        document.getElementById("time-label").innerHTML = "<font style=\"color: #000000;\">Select Time";
        serviceText.innerHTML = "<a href=\"https://reports.appheaven.us/online/tcbbe.php?merchantid=" + merchantId + "&force=1\" style=\"color: #ffffff;padding:10px;\";><center>Please select an employee or tap here to select an employee first</center></a>";
        //serviceText.style.backgroundColor = "#000000" ;
    }
    else if (merchantId == '42ZEP2RY47Y91') {
        employeeCalled = " Your Lane";
        document.getElementById("service-label").innerHTML = "Select Your Axe Throwing";
        document.getElementById("tech-name").innerHTML = "<font style=\"color: #000000;\">Select Your Lane";
    }
    else if (merchantId == 'ME04JC3GEXDW1') {
        employeeCalled = " Your Boat";
        document.getElementById("service-label").innerHTML = "Select Your Package";
        document.getElementById("tech-name").innerHTML = "<font style=\"color: #000000;\">Select Your Boat";
    }
    else {
        employeeCalled = " Service Technicians";
    }
    if (jsonMerchant.damt == 100) { // it's a percent
        serviceText.innerHTML = "Full payment will include applicable taxes.";
    }

    var property = document.getElementById("input-submit");
    document.getElementById("input-submit").onclick = function () { confirmAppointment() };
    // added to quickly support not showing pricing...
    if (advance == -1) {
        pricing = false;
        advance = 2;
    }
    //         if (count == 0) {
    if (merchantId == 'C2R0FTY15JWV1') {
        console.log("changed button color");
        property.style.backgroundColor = "#f8dadf";
        property.style.color = "#000000";
    }
    else if (merchantId == '1KZCSK24QVVS1') {
        console.log("changed button color");
        property.style.backgroundColor = "#f0a7ca";
        property.style.color = "#000000";
    }
    else if (merchantId == 'P2WBVAH86DHM1') {
        console.log("changed button color");
        property.style.backgroundColor = "#eddbdb";
        property.style.color = "#000000";
    }
    else if (merchantId == '8SSW5MZRZZ331') {
        console.log("changed button color");
        property.style.backgroundColor = "#1e1000";
        property.style.color = "#ffffff";
    }
    else if (merchantId == '3PJ2HVGSVJ2Z1') {
        console.log("changed button color");
        property.style.backgroundColor = "#f5e27b";
        property.style.color = "#000000";
    }
    else if (merchantId == 'RHYRW6SA1KMK1') {
        console.log("changed button color");
        property.style.backgroundColor = "#dc1171";
        property.style.color = "#FFFFFF";
    }
    else if (merchantId == 'WM75P60P5M5D1') {
        console.log("changed button color");
        property.style.backgroundColor = "#e9cdb2";
        property.style.color = "#000000";
    }
    else if (merchantId == 'HVVF1HFQSBYM1') {
        console.log("changed button color");
        property.style.backgroundColor = "#000000";
        property.style.color = "#ffffff";
    }
    else if (merchantId == 'EZHNVS95VVC6G') {
        console.log("changed button color");
        property.style.backgroundColor = "#f6ebe0";
        property.style.color = "#C34C25";
    }
    else if (merchantId == '1K4RDS78JHQAE' || merchantId == '3KS5T367F5BV1' || merchantId == 'DSTHHVR2AYB01') {
        console.log("changed button color");
        property.style.backgroundColor = "#000000";
        property.style.color = "#FFFFFF";
    }

    console.log("empxOrder=" + emporder);
    console.log("confirm text:" + confirmText);
    LoadEmployees();
    if (accessKey.length < 2) {
        prepay = 0;
    }
    // set firstname and lastname and email if this is a revisit from the same browser....
    if (localStorage) {
        var savedFirstName = localStorage.getItem("firstName");
        var savedLastName = localStorage.getItem("lastName");
        var savedEmail = localStorage.getItem("emailAddress");
        var savedPhone = localStorage.getItem("phoneNumber");
        console.log("saved name:" + savedFirstName);
        console.log("saved lastname:" + savedLastName);
        console.log("saved email:" + savedEmail);
        console.log("saved phone:" + savedPhone);

        if (savedFirstName != null && savedFirstName.length > 1) {
            document.getElementById("input-first").value = savedFirstName;
        }
        if (savedLastName != null && savedLastName.length > 1) {
            document.getElementById("input-last").value = savedLastName;
        }
        if (savedEmail != null && savedEmail.length > 1) {
            document.getElementById("input-email").value = savedEmail;
        }
        if (savedPhone != null && savedPhone.length > 1) {
            document.getElementById("input-phone").value = savedPhone;
        }
    }
    if (prepay) {
        console.log("aK:" + accessKey);
        clover = new Clover(accessKey);
        elements = clover.elements();
        const cardNumber = elements.create('CARD_NUMBER', styles);
        const cardDate = elements.create('CARD_DATE', styles);
        const cardCvv = elements.create('CARD_CVV', styles);
        const cardPostalCode = elements.create('CARD_POSTAL_CODE', styles);

        //cardNumber.mount(document.getElementById("card-number").value);
        //cardDate.mount(document.getElementById("card-date").value);
        //cardCvv.mount(document.getElementById("card-cvv").value);
        //cardPostalCode.mount(document.getElementById("card-postal-code").value);
        cardNumber.mount('#card-number');
        cardDate.mount('#card-date');
        cardCvv.mount('#card-cvv');
        cardPostalCode.mount('#card-postal-code');
        const cardResponse = document.getElementById('card-response');
        const displayCardNumberError = document.getElementById('card-number-errors');
        const displayCardDateError = document.getElementById('card-date-errors');
        const displayCardCvvError = document.getElementById('card-cvv-errors');
        const displayCardPostalCodeError = document.getElementById('card-postal-code-errors');
        cardNumber.addEventListener('change', function (event) {
            errorcheck(event);
            console.log(`cardNumber changed ${JSON.stringify(event)}`);
        });

        cardNumber.addEventListener('blur', function (event) {
            errorcheck(event);
            console.log(`cardNumber blur ${JSON.stringify(event)}`);
        });

        cardDate.addEventListener('change', function (event) {
            errorcheck(event);
            console.log(`cardDate changed ${JSON.stringify(event)}`);
        });

        cardDate.addEventListener('blur', function (event) {
            errorcheck(event);
            console.log(`cardDate blur ${JSON.stringify(event)}`);
        });

        cardCvv.addEventListener('change', function (event) {
            errorcheck(event);
            console.log(`cardCvv changed ${JSON.stringify(event)}`);
        });

        cardCvv.addEventListener('blur', function (event) {
            errorcheck(event);
            console.log(`cardCvv blur ${JSON.stringify(event)}`);
        });

        cardPostalCode.addEventListener('change', function (event) {
            errorcheck(event);
            console.log(`cardPostalCode changed ${JSON.stringify(event)}`);
        });

        cardPostalCode.addEventListener('blur', function (event) {
            errorcheck(event);
            console.log(`cardPostalCode blur ${JSON.stringify(event)}`);
        });
    }
    var intro = 'In order, (1) select your employee, (2) service(s), and (3) an available date (and time slot). If you would like to select MORE THAN 1 SERVICE, please go back to the drop down menu and select each additional service. Tapping OK means you are agreeing to the use of localStorage to save your preferences.';
    console.log("intro:" + introText);
    if (introText.length > 2) {
        intro = introText;
    }
    if (intro != "none") {
        //Swal.fire( 'Welcome!', intro,)
        Swal.fire({
            title: "Welcome!",
            text: intro,
            confirmButtonColor: "#2AB7A9",
            cancelButtonColor: "#2AB7A9",
        });
    }


    date = new Date(mymin.local().year(), mymin.local().month(), mymin.local().date());
    // first day of month
    var lastDayOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    var firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
    var time_difference = lastDayOfMonth.getTime() - date.getTime();
    //calculate days difference by dividing total milliseconds in a day  
    var days = (time_difference / (1000 * 60 * 60 * 24)) + 11;
    lastApptDate = date;
    lastApptDate.setDate(lastApptDate.getDate() + days);
    console.log("calling getdate function:" + firstDay + " for " + days + " new last day:" + lastApptDate);
    getappointments(firstDay.getTime(), 31);
});

function errorcheck(e) {
    errorstring = JSON.stringify(e);
    if (errorstring.includes("error")) {
        console.log("still have errors in card info");
        infogood = 0;
        return;
    }
    if (errorstring.includes("false")) {
        console.log("still have errors in card info");
        infogood = 0;
        return;
    }
    console.log("card info good");
    infogood = 1;
}

function ToMinutes(timeSpan) {
    var chunks = timeSpan.split(":");
    if (chunks.length == 3) {
        return parseInt(chunks[0]) * 60 + parseInt(chunks[1]);
    }
    return 0;
}

// only works for services under 10 hours
function AddMinutes(timeSpan, mins) {
    var cur = ToMinutes(timeSpan);
    cur += mins;
    if (cur == 0) {
        return "00:00:00";
    }
    else if (cur < 60) {
        return "00:" + cur + ":00";
    }
    else if (cur % 60 == 0) {
        return "0" + Math.floor(cur / 60) + ":00:00";
    }
    else {
        return "0" + Math.floor(cur / 60) + ":" + cur % 60 + ":00";
    }
}

function timeslotChanged(e) {
    thisTime = $('#timeslot').val();
    console.log("picked timeslot value:" + thisTime);
}

$(document).click(function (e) {
    if (datePicked && selectedServicesDuration != lastDuration) {
        console.log("dropdown just closed");
        lastDuration = selectedServicesDuration;
        FillEmployeesAndTimeSlots(1);
    }
});

function showAddOns(showit) {
    let elementjunk = document.getElementById("junk");

    if (showit == true) {
        elementjunk.removeAttribute("hidden");
        $('select:not(.swal2-select)').formSelect();

    } else {
        elementjunk.setAttribute("hidden", "hidden");
    }
}

function Round(min) {
    var y = Math.ceil(min / 5) * 5;
    return y;
}

async function addOnChanged(e) {
    orgAddOns = $('#addons').val();
    if (orgselectedServices != null && orgAddOns != null) {
        selectedServices = orgselectedServices.concat(orgAddOns);
    }
    else if (orgselectedServices == null) {
        console.log("nothing yet");
        serviceText.innerHTML = "Please select a service.";
        showAddOns(false);
        return;
    }

    servicePicked = false;
    if (prepay) {
        document.getElementById("input-amount").value = "DEPOSIT $0.00";
    }
    chargeAmount = 0;
    if (!selectedServices) {
        console.log("nothing yet");
        serviceText.innerHTML = "Please select a service.";
        showAddOns(false);
        return;
    }
    // reset everything
    var len = selectedServices.length;
    // if nothing selected, erase everything
    if (len == 0) {
        if (prepay) {
            document.getElementById("input-amount").value = "HOLD $0.00";
        }
        showAddOns(false);
        return;
    }
    servicePicked = true;
    var totalAmount = 0;
    selectedServicesDuration = 0;
    var newHoldAmount = 0;

    var ser = "";
    holdpercent = 0;
    if (jsonMerchant.damt == 100) { // it's a percent
        holdpercent = 100;
    }
    var hasVariableItem = false;
    for (var i = 0; i < len; i++) {
        var thisServiceIndex = selectedServices[i];
        if (serviceJSON[thisServiceIndex].price == 0) {
            hasVariableItem = true;
        }
        totalAmount += serviceJSON[thisServiceIndex].price;
        // figure out the duration of the service
        selectedServicesDuration += ToMinutes(serviceJSON[thisServiceIndex].duration);
        if (jsonMerchant.hasOwnProperty('svcbreak') && jsonMerchant.svcbreak == true) {
        }
        else {
            console.log("skipping break duration display");
            selectedServicesDuration += ToMinutes(serviceJSON[thisServiceIndex].breakDuration);
        }
        if (serviceJSON[thisServiceIndex].hasOwnProperty('finish')) {
            selectedServicesDuration += Round(serviceJSON[thisServiceIndex].finish);
        }
        // if prepay, check each service for a deposit % or set amount and add all these together
        if (prepay) {
            if (serviceJSON[thisServiceIndex].holdtype != null) {
                if (serviceJSON[thisServiceIndex].holdtype == 2) { // fixed amount in dollars
                    if (serviceJSON[thisServiceIndex].hold != null && serviceJSON[thisServiceIndex].hold > 0) {
                        newHoldAmount += (serviceJSON[thisServiceIndex].hold * 100);
                    }
                }
                else { // percent
                    if (serviceJSON[thisServiceIndex].hold != null) {
                        newHoldAmount += (serviceJSON[thisServiceIndex].hold * serviceJSON[thisServiceIndex].price / 100.0);
                    }
                }
            }
        }
        console.log("time:" + serviceJSON[thisServiceIndex].duration);
        console.log("name:" + serviceJSON[thisServiceIndex].name);
        console.log("totals:" + totalAmount + " duration:" + selectedServicesDuration + " service:" + serviceJSON[thisServiceIndex].name);
        if (holdpercent >= 100.0) {
            ser = ser + serviceJSON[thisServiceIndex].posID + ":::";
        }
    }
    // calculate the charge amount for the deposit
    //
    if (holdpercent > 0) { // get and display the total
        chargeAmount = Math.ceil(totalAmount * holdpercent / 100.0);
    }
    else { // make it positive...its an amount
        chargeAmount = -1 * holdpercent * 100.0;
    }
    if (prepay) {
        // right here, if there is a damt, use it if the hold amount is zero...
        if (newHoldAmount == 0 && chargeAmount == 0 && jsonMerchant.damt != null) {
            if (jsonMerchant.damt > 0) { // it's a percent
                newHoldAmount = Math.ceil(totalAmount * jsonMerchant.damt / 100.0);
                if (newHoldAmount == 0) { // if it's variable priced item with a % then it's gonna be zero..use 25 for now
                    newHoldAmount = 2500;
                }
            }
            else if (jsonMerchant.damt < 0) {
                var xamt = jsonMerchant.damt * -1 * 100;
                if (xamt > totalAmount && totalAmount > 0 && hasVariableItem == false) {
                    xamt = totalAmount;
                }
                if (totalAmount > 10000 && merchantId == "3Z2MZRC41Z2R1") {
                    xamt = 10000;
                }
                newHoldAmount = xamt;
                console.log("xamt:" + xamt + " nha:" + newHoldAmount + " ta:" + totalAmount + " damt:" + jsonMerchant.damt);
            }
        }

        if (newHoldAmount > 0) {
            chargeAmount = newHoldAmount;
        }
        if (holdpercent >= 100.0) {
            await getservices(ser);
            chargeAmount = totalbasket;
        }
        console.log("chargeamt:" + chargeAmount + " totalamt:" + totalAmount);

        // for some merchants, if some employees, change deposit to 0 
        if (merchantId == "WXRBGW1HM70N1") {
            if (pickedEmployee >= 0 && employeePicked == true) {
                if (employeeJSON[pickedEmployee].posID == "EHZKBN4JE5B7R") {
                    chargeAmount = 0;
                }
            }
        }

        document.getElementById("input-amount").value = "HOLD " + currencyFormat(chargeAmount / 100.0);
        if (holdpercent >= 100.0) {
            var tax = chargeAmount - totalAmount;
            if (tax > 0) {
                confirmstring = "Payment total of " + currencyFormat(chargeAmount / 100.0) + " includes TAX (" + currencyFormat(tax / 100.0) + ")";
                document.getElementById("input-amount").value = "CHARGE " + currencyFormat(chargeAmount / 100.0) + " includes TAX (" + currencyFormat(tax / 100.0) + ")";
            }
            else {
                confirmstring = "Payment total of " + currencyFormat(chargeAmount / 100.0);
            }
        }

        if (chargeAmount == 0) {
            document.getElementById("input-amount").style.display = 'none';
            document.getElementById("amount-box").style.display = 'none';
            document.getElementById("card-number").style.display = 'none';
            document.getElementById("card-date").style.display = 'none';
            document.getElementById("card-cvv").style.display = 'none';
            document.getElementById("card-postal-code").style.display = 'none';
            console.log("elements off");
        }
        else {
            document.getElementById("input-amount").style.display = 'block';
            document.getElementById("amount-box").style.display = 'block';
            document.getElementById("card-number").style.display = 'block';
            document.getElementById("card-date").style.display = 'block';
            document.getElementById("card-cvv").style.display = 'block';
            document.getElementById("card-postal-code").style.display = 'block';
            console.log("elements on");
        }
    }
    else {
        chargeAmount = 0;
    }
    // we keep the negative amount to signify immediate charge
    if (chargenow) {
        chargeAmount = chargeAmount * -1;
        console.log("chargenow:" + chargeAmount);
    }
    // close the dropdown
    serviceText.innerHTML = "You've chosen <b><i><span class=\"new badge\">" + selectedServicesDuration + "</span>" + len + " </i></b>service(s) for a total appointment duration of <b><i>" + selectedServicesDuration + " </i></b>minutes.";
    if (jsonMerchant.damt == 100) { // it's a percent
        serviceText.innerHTML = "Full payment will include applicable taxes.";
    }

    if (datePicked) {
        lastDuration = selectedServicesDuration;
        FillEmployeesAndTimeSlots(1);
    }
    // calculate the DEFAULT durations for the services that have been picked ..later on we can 
    // account for employee variance once they pick an actual employee
    if (!servicePicked) {
        inputField = document.getElementById("caleran");
        inputField.value = '';
        datePicked = false;
    }
}

async function serviceChanged(e) {
    if (!servicePicked || !employeePicked) {
        inputField = document.getElementById("caleran");
        inputField.value = '';
        datePicked = false;
    }
    orgselectedServices = $('#services').val();
    if (orgselectedServices != null && orgAddOns != null) {
        selectedServices = orgselectedServices.concat(orgAddOns);
    }
    else {
        selectedServices = orgselectedServices;
    }

    servicePicked = false;
    if (prepay) {
        document.getElementById("input-amount").value = "DEPOSIT $0.00";
    }
    chargeAmount = 0;
    //console.log($(this).val());
    if (!selectedServices) {
        console.log("nothing yet");
        serviceText.innerHTML = "Please select a service.";
        return;
    }
    // reset everything
    var len = selectedServices.length;
    // if nothing selected, erase everything
    if (len == 0) {
        if (prepay) {
            document.getElementById("input-amount").value = "HOLD $0.00";
        }
        return;
    }
    // calculate the DEFAULT durations for the services that have been picked ..later on we can 
    // account for employee variance once they pick an actual employee
    if (len > 1) {
        if (merchantId != '13AZX8XYVDMT1' && merchantId != 'XX1F67CZXGSY1') { // dont display break time for all services for this merchant
            Swal.fire({
                title: 'Attention!',
                icon: "warning",
                text: 'You have selected more than 1 service in this booking. If you intended to only select 1 service, please uncheck the previously selected service.',
                confirmButtonText: 'OK, thanks!'
            });
        }
    }

    var cnt = 0;
    var jonce = 0;
    for (var i = 0; i < len; i++) {
        var thisServiceIndex = selectedServices[i];
        if (serviceJSON[thisServiceIndex].combine != null) {
            if (serviceJSON[thisServiceIndex].combine == 1) {
                // first make a list of all the other services with same combination number....
                var slen = serviceJSON.length;
                if (jonce == 0) {
                    jonce = 1;
                    Swal.fire({
                        title: 'Attention!',
                        icon: "warning",
                        text: 'This service pairs best with additional add on services. Please choose your add on services.',
                        confirmButtonText: 'OK, thanks!'
                    });
                }
                // create the group label and add ons if they don't already exist
                if (!addongroups.includes(serviceJSON[thisServiceIndex].name)) {
                    addongroups += serviceJSON[thisServiceIndex].name;
                    $('.addons').append("<optgroup label='Add Ons for " + serviceJSON[thisServiceIndex].name + "'>");
                    for (var z = 0; z < slen; z++) {
                        console.log("checking add on:" + serviceJSON[z].name + " list:[" + serviceJSON[z].addons + "] for:" + serviceJSON[thisServiceIndex].addons);
                        if (serviceJSON[z].posID == serviceJSON[thisServiceIndex].posID || serviceJSON[z].combine == 1) {
                            continue;
                        }
                        if (serviceJSON[z].addons == null) {
                            continue;
                        }
                        // add the add on to the list of add ons if its not already in the list...
                        if (serviceJSON[z].addons.length > 0 && serviceJSON[thisServiceIndex].addons.includes("," + serviceJSON[z].addons)) {
                            CreateAddOnOption(z);
                            cnt++;
                        }
                        else if (serviceJSON[z].addons.length > 0 && serviceJSON[thisServiceIndex].addons.startsWith(serviceJSON[z].addons)) {
                            CreateAddOnOption(z);
                            cnt++;
                        }
                    }
                    // close this group
                    $('.addons').append("</optgroup>");
                    if (cnt > 0) {
                        showAddOns(true);
                    }
                    else {
                        showAddOns(false);
                    }
                }
            }
        }
    }

    var ser = "";
    servicePicked = true;
    var totalAmount = 0;
    selectedServicesDuration = 0;
    var newHoldAmount = 0;
    holdpercent = 0;
    if (jsonMerchant.damt == 100) { // it's a percent
        holdpercent = 100;
    }
    var hasVariableItem = false;
    for (var i = 0; i < len; i++) {
        var thisServiceIndex = selectedServices[i];
        if (serviceJSON[thisServiceIndex].price == 0) {
            hasVariableItem = true;
        }
        totalAmount += serviceJSON[thisServiceIndex].price;
        // figure out the duration of the service
        // if employee picked, find the duration/break/finish for that particular employee 
        if (pickedEmployee >= 0) {
            var length = employeeJSON[pickedEmployee].serviceCfgs.length;
            for (var k = 0; k < length; k++) {
                var serviceObj = employeeJSON[pickedEmployee].serviceCfgs[k];
                if (serviceObj.posID == serviceJSON[thisServiceIndex].posID) {
                    selectedServicesDuration += ToMinutes(serviceObj.duration);
                    if (jsonMerchant.hasOwnProperty('svcbreak') && jsonMerchant.svcbreak == true) {
                    }
                    else {
                        selectedServicesDuration += ToMinutes(serviceObj.breakDuration);
                    }
                    if (len == 1 && merchantId == '39H7QZX3FPDH1') {
                        selectedServicesDuration -= ToMinutes(serviceJSON[thisServiceIndex].breakDuration);
                    }
                    if (serviceObj.hasOwnProperty('finish')) {
                        selectedServicesDuration += serviceObj.finish;
                    }
                    break;
                }
            }
        }
        else {
            selectedServicesDuration += ToMinutes(serviceJSON[thisServiceIndex].duration);
            if (jsonMerchant.hasOwnProperty('svcbreak') && jsonMerchant.svcbreak == true) {
            }
            else {
                selectedServicesDuration += ToMinutes(serviceJSON[thisServiceIndex].breakDuration);
            }
            if (len == 1 && merchantId == '39H7QZX3FPDH1') {
                selectedServicesDuration -= ToMinutes(serviceJSON[thisServiceIndex].breakDuration);
            }

            if (serviceJSON[thisServiceIndex].hasOwnProperty('finish')) {
                selectedServicesDuration += serviceJSON[thisServiceIndex].finish;
            }
        }

        // if prepay, check each service for a deposit % or set amount and add all these together
        if (prepay) {
            if (serviceJSON[thisServiceIndex].holdtype != null) {
                if (serviceJSON[thisServiceIndex].holdtype == 2) { // fixed amount in dollars
                    if (serviceJSON[thisServiceIndex].hold != null) {
                        newHoldAmount += (serviceJSON[thisServiceIndex].hold * 100);
                    }
                }
                else { // percent
                    if (serviceJSON[thisServiceIndex].hold != null) {
                        newHoldAmount += (serviceJSON[thisServiceIndex].hold * serviceJSON[thisServiceIndex].price / 100.0);
                    }
                }
            }
        }
        console.log("time:" + serviceJSON[thisServiceIndex].duration);
        console.log("name:" + serviceJSON[thisServiceIndex].name);
        console.log("totals:" + totalAmount + " duration:" + selectedServicesDuration + " service:" + serviceJSON[thisServiceIndex].name);
        if (holdpercent >= 100.0) {
            ser = ser + serviceJSON[thisServiceIndex].posID + ":::";
        }
    }
    // calculate the charge amount for the deposit
    //
    if (holdpercent > 0) { // get and display the total
        chargeAmount = Math.ceil(totalAmount * holdpercent / 100.0);
    }
    else { // make it positive...its an amount
        chargeAmount = -1 * holdpercent * 100.0;
    }

    if (prepay) {
        // if there is a global hold amt then use it if the total's are zero for the hold...
        if (newHoldAmount == 0 && chargeAmount == 0 && jsonMerchant.damt != null) {
            if (jsonMerchant.damt > 0) { // it's a percent
                newHoldAmount = Math.ceil(totalAmount * jsonMerchant.damt / 100.0);
                if (newHoldAmount == 0) { // if it's variable priced item with a % then it's gonna be zero..use 25 for now
                    newHoldAmount = 2500;
                }
            }
            else if (jsonMerchant.damt < 0) {
                var xamt = jsonMerchant.damt * -1 * 100;
                if (xamt > totalAmount && hasVariableItem == false) {
                    xamt = totalAmount;
                }
                if (totalAmount > 10000 && merchantId == "3Z2MZRC41Z2R1") {
                    xamt = 10000;
                }
                newHoldAmount = xamt;
                console.log("xamt:" + xamt + " nha:" + newHoldAmount + " ta:" + totalAmount);
            }
        }
        if (newHoldAmount > 0) {
            chargeAmount = newHoldAmount;
        }
        if (holdpercent >= 100.0) {
            await getservices(ser);
            chargeAmount = totalbasket;
        }
        console.log("chargeamt:" + chargeAmount + " totalamt:" + totalAmount);
        if (merchantId == "WXRBGW1HM70N1") {
            if (pickedEmployee >= 0 && employeePicked == true) {
                if (employeeJSON[pickedEmployee].posID == "EHZKBN4JE5B7R") {
                    chargeAmount = 0;
                }
            }
        }
        document.getElementById("input-amount").value = "HOLD " + currencyFormat(chargeAmount / 100.0);
        if (holdpercent >= 100.0) {
            var tax = chargeAmount - totalAmount;
            if (tax > 0) {
                confirmstring = "Payment total of " + currencyFormat(chargeAmount / 100.0) + " includes TAX (" + currencyFormat(tax / 100.0) + ")";
                document.getElementById("input-amount").value = "CHARGE " + currencyFormat(chargeAmount / 100.0) + " includes TAX (" + currencyFormat(tax / 100.0) + ")";
            }
            else {
                confirmstring = "Payment total of " + currencyFormat(chargeAmount / 100.0);
            }
        }

        if (chargeAmount == 0) {
            document.getElementById("input-amount").style.display = 'none';
            document.getElementById("amount-box").style.display = 'none';
            document.getElementById("card-number").style.display = 'none';
            document.getElementById("card-date").style.display = 'none';
            document.getElementById("card-cvv").style.display = 'none';
            document.getElementById("card-postal-code").style.display = 'none';
            console.log("elements off");
        }
        else {
            document.getElementById("input-amount").style.display = 'block';
            document.getElementById("amount-box").style.display = 'block';
            document.getElementById("card-number").style.display = 'block';
            document.getElementById("card-date").style.display = 'block';
            document.getElementById("card-cvv").style.display = 'block';
            document.getElementById("card-postal-code").style.display = 'block';
            console.log("elements on");
        }
    }
    else {
        chargeAmount = 0;
    }
    // we keep the negative amount to signify immediate charge
    if (chargenow) {
        chargeAmount = chargeAmount * -1;
        console.log("chargenow:" + chargeAmount);
    }
    // close the dropdown
    //$(this).click();
    serviceText.innerHTML = "You've chosen <b><i><span class=\"new badge\">" + selectedServicesDuration + "</span>" + len + " </i></b>service(s) for a total appointment duration of <b><i>" + selectedServicesDuration + " </i></b>minutes.";

    if (datePicked) {
        lastDuration = selectedServicesDuration;
        FillEmployeesAndTimeSlots(1);
    }
}

function DisplayTimeSlots(z) {
    // take the employee string and parse it and make the parsed string into options to display 
    thisTime = 0;
    timePicked = false;
    $(".timeslot").empty();
    console.log("displaying time slots");
    if (employeeTimeString[z] == undefined) {
        employeePicked = false;
        timePicked = false;
        var newOption = new Option("No timeslots available", 0, false, false);
        $('.timeslot').append(newOption);
        // $('select').formSelect();
        $('select:not(.swal2-select)').formSelect();
        return;
    }
    var chunks = employeeTimeString[z].split("###");
    if (chunks.length <= 0) {
        employeePicked = false;
        timePicked = false;
        var newOption = new Option("No timeslots available", 0, false, false);
        $('.timeslot').append(newOption);
        //$('select').formSelect();
        $('select:not(.swal2-select)').formSelect();
        return;
    }
    for (var i = 0; i < chunks.length; i++) {
        var info = chunks[i].split("~");
        if (info[0].length <= 2) {
            continue;
        }
        var newOption = new Option(info[0], info[1], false, false);
        //appendButton("timegrid", info[0], info[1]);
        $('.timeslot').append(newOption);
        if (timePicked == false) {
            timePicked = true;
            thisTime = info[1];
            console.log("using default time of:" + thisTime);
        }
    }
    $('select:not(.swal2-select)').formSelect();
}

function appendButton(elementId, name, value) {
    var buttonEl = document.createElement("a");
    buttonEl.style.width = '200px';
    //buttonEl.href = url;
    var buttonTextEl = document.createElement("span");
    buttonTextEl.className = "waves-effect waves-light btn";
    buttonTextEl.innerText = name;
    buttonEl.appendChild(buttonTextEl);
    buttonEl.addEventListener("click", function () {
        alert("did something:" + value);
    });
    document.getElementById(elementId).appendChild(buttonEl);
}

function FillTimeArray(z, totalDuration) {
    var dtx = new timezoneJS.Date(jsonMerchant.timezone);
    dtx.setTimezone(jsonMerchant.timezone);
    var offsetx = dtx.getTimezoneOffset();
    var offsetbrowserx = -1 * moment().utcOffset();
    offsetdiff = offsetbrowserx - dtx.getTimezoneOffset();
    console.log("offsettzdiff=" + offsetdiff);
    // if dayMode, we need to use the year, month, date that is being checked instead of using the selected date
    var useYear = thisDateYear;
    var useMonth = thisDateMonth;
    var useDay = thisDateDay;
    var useDate = thisDate;

    var employee = employeeJSON[z];
    var dayOfWeek = new Date(useDate).getDay();
    // calc total service duration
    console.log("creating slots for useDate:" + useDate + "dow:" + dayOfWeek);

    var DateTimeMax = moment(useDate).add(23, 'h').toDate();
    var DateTimeMin = moment(useDate).add(5, 'h').toDate();

    var employeeDayShifts = employee.shift[dayOfWeek];
    // check for holiday shift...either by date or by explicity force of use...
    if (employee.hasOwnProperty('holidayshift')) {
        console.log("has alternate shift");
        if (employee.hasOwnProperty('holidayhours')) {
            console.log("alternate shift force:" + employee.holidayhours);
            if (employee.holidayhours == true) {
                employeeDayShifts = employee.holidayshift[dayOfWeek];
            }
            else {
                checkunixtime = startDate.unix();
                console.log("alternate shift date secs:" + checkunixtime + " start:" + employee.holidaystart + " end:" + employee.holidayend);
                if (checkunixtime >= employee.holidaystart && checkunixtime <= employee.holidayend) {
                    var useShifts = true;
                    // if employee has a holiday shift, calculate if it's alternating or not
                    if (employee.hasOwnProperty('onoff')) {
                        // figure out weeks from the start date...if week is 1,3,5, etc.(odd), then alternating schedule is on
                        if (employee.onoff == true) {
                            var secsdiff = checkunixtime - employee.holidaystart;
                            var weeksince = Math.floor(secsdiff / (3600 * 24 * 7));
                            console.log(employee.name + " " + startDate + " weeks since start of alternate schedule:" + weeksince);
                            // if even..., then it's within the 7 days, etc. so it applies, otherwise, it's odd...doesn't apply
                            if (weeksince % 2 != 0) {
                                console.log("dont use alternating schedule " + startDate.date());
                                useShifts = false;
                            }
                        }
                    }
                    if (useShifts) {
                        console.log("use alternating schedule " + startDate.date());
                        employeeDayShifts = employee.holidayshift[dayOfWeek];
                    }
                }
            }
        }
    }

    var relativeWorkStart = (employeeDayShifts.workStart - (1440 * dayOfWeek)) / 5;
    var relativeWorkEnd = (employeeDayShifts.workEnd - (1440 * dayOfWeek)) / 5;
    var relativeBreakStart = (employeeDayShifts.breakStart - (1440 * dayOfWeek)) / 5;
    var relativeBreakEnd = (employeeDayShifts.breakEnd - (1440 * dayOfWeek)) / 5;
    console.log("relative times:" + relativeWorkStart * 5 / 60 + " " + relativeWorkEnd * 5 / 60 + " " + relativeBreakStart * 5 / 60 + " " + relativeBreakEnd * 5 / 60);

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
                console.log("got day off");
            }
            else {
                daysOn.push(employee.shiftMods[i]);
                console.log("got day on");
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
        var minInDay = mtoday.hours() * 60 + mtoday.minutes() + (60 * advance);
        var end = minInDay / 5;
        console.log("blocking til:" + end * 5 / 60 + " advance:" + advance);
        for (i = 0; i < end; i++) {
            timeOffArray[i] = true;
        }
    }

    var count = daysOn.length;
    if (!employeeDayShifts.workOn) {
        console.log("blocking full day");
        for (var i = 0; i < 350; i++) {
            timeOffArray[i] = true;
        }
    }
    else // at least 1 shift
    {
        //Add TimeOff for time from 5:00am to start time
        var startMinutes = 60;
        //if no daysOn then we can simplify the adding of work hours to the max 2 shifts that are separated by a break at most
        console.log("blocking 0 to " + relativeWorkStart * 5 / 60);
        for (var i = 0; i < relativeWorkStart; i++) {
            timeOffArray[i] = true;
        }
        //single shift...off from end of shift to end of day
        if (employeeDayShifts.workOn) {
            //Add TimeOff for time after end of workday
            startMinutes = relativeWorkEnd;
            console.log("blocking " + relativeWorkEnd * 5 / 60 + " to " + 350 * 5 / 60);
            for (var i = relativeWorkEnd; i < 350; i++) {
                timeOffArray[i] = true;
            }
        }  //double shift...off from  break beginning to end
        if (employeeDayShifts.breakOn) {
            console.log("blocking break " + relativeBreakStart * 5 / 60 + " to " + relativeBreakEnd * 5 / 60);
            for (var i = relativeBreakStart; i < relativeBreakEnd; i++) {
                timeOffArray[i] = true;
            }
        }
    }
    if (count > 0) // daysOn count
    {
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
                console.log("offsettzdiffapplied=" + offsetdiff);
            }

            console.log("XXXXXXXXXXXXXXXXXXXX adding back:" + beginOnMinutes * 5 / 60 + " to:" + endOnMinutes * 5 / 60);
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
        var minInDay = mtoday.hours() * 60 + mtoday.minutes() + (60 * advance);
        var end = minInDay / 5;
        console.log("blockingx til:" + end * 5 / 60 + " advance:" + advance);
        for (i = 0; i < end; i++) {
            timeOffArray[i] = true;
        }
    }

    var len = daysOff.length;
    console.log("got entries for day off:" + len);
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
            console.log("offsettzdiffapplied=" + offsetdiff);
        }

        console.log("begin:" + beginMinutes + " end:" + endMinutes);
        console.log("begin:" + daysOff[i].begin + " end:" + daysOff[i].end);

        console.log("XXXXXXXXXXXXXXXXXXXX removing:" + beginMinutes * 5 / 60 + " to:" + endMinutes * 5 / 60);
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
    console.log("got:" + arrayLength + " appointments");
    var addNext = true;
    var foundAtLeastOne = false;

    var dt = new timezoneJS.Date(jsonMerchant.timezone);
    dt.setTimezone(jsonMerchant.timezone);
    var offset = dt.getTimezoneOffset();
    console.log("offset:" + offset);
    var offsetbrowser = -1 * moment().utcOffset();
    console.log("this browser offset:" + offsetbrowser);
    var diff = (offsetbrowser - offset) / 60;
    var startIndex = 0;
    var endIndex = arrayLength;
    if (startDayAppt >= 0 && endDayAppt >= 0) {
        console.log("YYusing index:" + startDayAppt + " and end:" + endDayAppt + " counter:" + counter);
        counter++;
        startIndex = startDayAppt;
        endIndex = endDayAppt;
    }
    console.log("YYstart:" + startIndex + " and end:" + endIndex);
    for (i = startIndex; i < endIndex; i++) {
        // 6/28/2018 11:00 AM
        console.log("i=" + i + " got x time:" + apptJSON[i].foreignID);
        if (apptJSON[i].status == 5) {
            continue;
        }
        console.log("got time:" + apptJSON[i].foreignID);
        var checkM = moment.unix(apptJSON[i].foreignID / 1000);
        //var m = moment(apptJSON[i].localStart, 'M/DD/YYYY hh:mm A') ;
        var m = moment(apptJSON[i].localStart, useFormat);
        //console.log("m from localstart:" + m.year()+ ":" + m.month() + ":" + m.date() + ":" + m.hour() ) ;

        //online appts made with old scheduler are a risk...always use absolute time for now...may cause issue with dst 
        if (apptJSON[i].type == 1) {
            m = moment.unix(apptJSON[i].foreignID / 1000);
            m = m.add({ hour: diff });
            console.log("found online appt. Using absolute time not local time.");
        }
        else {
            if (m.hour() != (checkM.hour() + diff) || m.date() != checkM.date()) {
                m = moment.unix(apptJSON[i].foreignID / 1000);
                console.log("corrected weirdo appt id:" + apptJSON[i].posID + " localStart:" + apptJSON[i].localStart + "lhour:" + m.hour() + " ahour:" + checkM.hour());
                m = m.add({ hour: diff });
                //console.log("corrected weirdo appt id:" + apptJSON[i].posID + "hour:" + m.hour() + " month:"+ m.month() + " year:" + m.year() + " day:"+m.date()) ;
            }
            else {
                console.log("found normal appt.  Using local time.");
            }
        }

        console.log("Looking for appts on:" + useYear + ":" + useMonth + ":" + useDay + " this appt:" + m.year() + ":" + m.month() + ":" + m.date());
        if (useYear == m.year() && useDay == m.date() && useMonth == m.month()) {
            foundAtLeastOne = true;
            console.log(m.year() + ":" + m.month() + ":" + m.date() + ":" + m.hour());
            if (startDayAppt == -1) {
                console.log("YY found first appt on " + useDay + " month:" + useMonth + " index:" + i);
                startDayAppt = i;
            }
            //console.log("found normal appt id:" + apptJSON[i].posID + " localStart:" + apptJSON[i].localStart + "lhour:" + m.hour() + " ahour:"+ checkM.hour()) ;
            // check if this appointment has any services with the pickedEmployee...but have to iterate to keep the start/end correct
            var bindings = apptJSON[i].serviceBindings;
            var everyone = 0;
            if (apptJSON[i].hasOwnProperty('quicknote')) {
                if (apptJSON[i].quickote != null && apptJSON[i].quicknote.includes("include all")) {
                    everyone = 1;
                }
            }
            var len = bindings.length;
            //console.log("got " + len + " bindings");
            var start = Math.floor((m.hour() * 60 + m.minute()) / 5);
            var end = start;
            //console.log("checking appt with start:" + start + " and end" + end) ; 
            addNext = true;
            var assigned = "";
            for (var j = 0; j < len; j++) {
                assigned = "";
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
                    for (k = startX; k < endX; k++) {
                        timeOffArray[k] = true;
                    }
                }
                /* if there was a finish time, account for that... */
                if (bindings[j].hasOwnProperty('finish') && bindings[j].finish > 0) {
                    start2 = end;
                    start2 += ToMinutes(bindings[j].breakDuration) / 5;
                    end2 = start2;
                    end2 += bindings[j].finish / 5;
                    if (bindings[j].svcEmployeePOSID == employee.posID || assigned == employee.posID) {
                        //console.log("XXXX got appt at start:" + start * 5 / 60 + "(" + start + ") and end " + end * 5 / 60 + "(" + end + ")");
                        var startX = Math.floor(start2); // hour
                        var endX = Math.ceil(end2); // hour
                        for (k = startX; k < endX; k++) {
                            timeOffArray[k] = true;
                        }
                    }
                }
                if (bindings[j].isParallel) {
                    addNext = false;
                    // if parallel, the end of next appt will be the end of this appt.  Needed because previous appt may have had a difft end time
                    end = start + ToMinutes(bindings[j].duration) / 5;
                }
                else {
                    addNext = true;
                    /* if we haven't added the break time already, do so now so we can accurately calculate the start time of the next service */
                    if (bindings[j].hasOwnProperty('finish')) {
                        end += ToMinutes(bindings[j].breakDuration) / 5;
                        if (bindings[j].finish > 0) {
                            end += bindings[j].finish / 5;
                        }
                    }
                    else {
                        if (jsonMerchant.hasOwnProperty('svcbreak') && jsonMerchant.svcbreak == true) {
                            continue;
                        }
                        end += ToMinutes(bindings[j].breakDuration) / 5;
                    }
                }
            }
        }
        else {
            if (startDayAppt >= 0 && endDayAppt < 0) { // we had a start date
                console.log("YYfound last appt on " + useDay + " month:" + useMonth + " index:" + i);
                if (foundAtLeastOne) {
                    endDayAppt = i;
                    break;
                }
                //break ;
            }
        }
    }
    if (startDayAppt < 0) { // means no appointments were found for this date
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
    console.log("totalduration:" + runLength + " interval:" + interval + " looking for:" + runLength + " duration:" + totalDuration);
    var slots = 0;
    var timestring = "";
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
            var ampm = " am";
            if (hh > 12) {
                hh -= 12;
                ampm = " pm";
            }
            if (hh == 12) {
                ampm = " pm";
            }
            if (hh == 0) {
                hh = 12;
                ampm = " am";
            }
            // don't allow booking pre 6 am to handle a bug with the time on/off that seems make wild, early slots available
            if (hh < 6 && ampm == " am") {
                continue;
            }
            if (first == 1) {
                first = 0;
                if (ampm == ' pm' && hh != 12) {
                    realhours = hh + 12;
                }
                else {
                    realhours = hh;
                }
                console.log("Foundx earliest time hour " + hh + " this one is:" + (realhours * 60 + mm));
                if (((realhours * 60) + mm) < earliestEmployeeTime) {
                    earliestEmployeeTime = (realhours * 60) + mm;
                    earliestEmployeeNumber = z;
                    console.log("Foundx earliest time = " + earliestEmployeeTime + " number=" + earliestEmployeeNumber);
                }
            }
            //console.log("added to time string:" + hh + ":" + pad2(mm)) ; 
            timestring = timestring + hh + ":" + pad2(mm) + ampm + "~" + min + "###";
        }
        runGood = true;
    }
    // if we got here then we don't have a good run for this employee for the days (not including the actually selected date which is zzz = -1
    console.log("Got time options for employee " + z + " = " + timestring);
    employeeTimeString[z] = timestring;
}

function pad2(number) {
    return (number < 10 ? '0' : '') + number
}

function Reset() {
    haveCaptcha = 0 ;
    $(".services").empty();
    $(".timeslot").empty();
    $(".employee").empty();

    selectedServices = [];
    selectedServicesDuration = 0;
    lastDuration = 0;
    employeeTimeString = [];

    servicePicked = false;
    employeePicked = false;
    timePicked = false;
    datePicked = false;
    pickedEmployee = -1;
    chargeAmount = 0;
    employeeCalled = "";

    thisDate = "";
    thisDateMoment;
    thisDateYear;
    thisDateMonth;
    thisDateDay;
    thisTime = 0;
}

function validateEmail(email) {
    if (email == "") {
        email = "no-email-provided@email.com";
    }
    var re = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(String(email).toLowerCase());
}

function BookNow(firstName, lastName, emailAddress, phoneNumber, address, zip, ccdata, note) {
    if (bookingStarted == 1) {
        Swal.fire(
            'Please wait!',
            'We are currently booking your appointment.',
            'warning',
        );
        return;
    }
    bookingStarted = 1;
    var jsonOther = {};
    // take all selected services and determine the service duration, break duration, name for each service
    var len = selectedServices.length;

    var totalDuration = 0;
    var jsonArray = [];
    var servicenames = "";
    var unique = 0;
    console.log("len :" + len);
    // only give 5 minutes to book!
    var nowTime = new Date().getTime();
    var thisdiff = nowTime - startSessionTime;
    if (thisdiff > (15 * 60 * 1000)) {
        console.log("session timeout:" + thisdiff);
        Swal.fire({
            title: 'Timeout!',
            text: "You've been logged out due to inactivity. Please book again.",
            showCancelButton: true,
            icon: "warning",
            confirmButtonText: 'Ok, thanks!',
            denyButtonText: 'Cancel',
        }).then((result) => {
            /* Read more about isConfirmed, isDenied below */
            if (result.isConfirmed) {
                Reset();
                location.reload(true);
            } else if (result.isDenied) {
                Reset();
                location.reload(true);
            }
        })
        return;
    }
    console.log("okay session timeout:" + thisdiff);
    var ubreak = 0;
    var first = 0;
    if (jsonMerchant.hasOwnProperty('ubreak')) {
        ubreak = jsonMerchant.ubreak;
        first = 1;
    }

    for (var k = 0; k < len; k++) {
        console.log("index :" + k + " employee:" + pickedEmployee);
        var thisServiceIndex = selectedServices[k];
        var posID = serviceJSON[thisServiceIndex].posID;
        // check all employee services to see if this employee offers this service
        var length = employeeJSON[pickedEmployee].serviceCfgs.length;
        console.log("Found " + length + " services");
        var d = new Date();
        var ticks = ((d.getTime() * 10000) + 621355968000000000);
        for (var j = 0; j < length; j++) {
            ticks += 100200;
            console.log("checking " + j + " Service" + "ticks:" + ticks);
            var serviceObj = employeeJSON[pickedEmployee].serviceCfgs[j];
            if (serviceObj.posID == posID) {
                servicenames = serviceObj.name + "-" + servicenames;
                var jsonServices = {};
                jsonServices.id = ticks;
                jsonServices.servicePOSID = posID;
                jsonServices.svcEmployeePOSID = employeeJSON[pickedEmployee].posID;
                jsonServices.duration = serviceObj.duration;
                if (ubreak > 0 && first == 1) {
                    jsonServices.duration = AddMinutes(jsonServices.duration, ubreak);
                }
                jsonServices.breakDuration = serviceObj.breakDuration;
                if (serviceObj.hasOwnProperty('finish')) {
                    jsonServices.finish = serviceObj.finish;
                }
                jsonServices.isParallel = false;
                jsonArray[unique] = jsonServices;
                unique++;
                totalDuration += ToMinutes(serviceObj.duration);
                //if (len > 1) {
                totalDuration += ToMinutes(serviceObj.breakDuration);
                if (ubreak > 0 && first == 1) {
                    first = 0;
                    totalDuration += ubreak;
                    console.log("adding ubreak:" + ubreak);
                }
                //}
            }
        }
    }
    if (unique == 0) {
        Swal.fire(
            'Problem!',
            'There is a problem booking this appointment. Please refresh your browser and retry this booking or call the Salon. Thank you.',
            'error',
        );
        return;
    }

    // we need to determine if this is the day of dst...
    var dstDate = false;
    var dstEndsDate = false;
    var dayBeforeOrg = thisDateMoment.clone();
    var dayBefore = dayBeforeOrg.local().add({ days: -1 });

    var offset = -1 * moment().utcOffset();
    console.log("this browser offset:" + offset);
    var m = thisDateMoment.local().add({ minutes: thisTime });
    if (m.isDST() == false && dayBefore.isDST() == true && m.day() == 0) {
        console.log("this date is the day DST starts");
        dstDate = true;
        m.add({ minutes: 60 });
    }
    else if (m.isDST() == true && dayBefore.isDST() == false && m.day() == 0) { // sunday
        console.log("this date is the day DST ends2x");
        dstEndsDate = true;
        m.add({ minutes: -60 });
    }
    //jsonOther.localStart = m.format('M/DD/YYYY hh:mm A') ; // local time of appointment.
    jsonOther.localStart = m.format(useFormat); // local time of appointment.
    var dt = new timezoneJS.Date(m.format('M/DD/YYYY', jsonMerchant.timezone));
    dt.setTimezone(jsonMerchant.timezone);
    offset = dt.getTimezoneOffset();
    if (dstDate) {
        offset += 60;
    }
    else if (dstEndsDate) {
        offset -= 60;
    }

    console.log("offset tz:" + dt.getTimezoneOffset() + " for timezone:" + jsonMerchant.timezone);
    var utcTime = m.add({ minutes: offset });
    jsonOther.start = utcTime.format('YYYY-MM-DDTHH:mm:ss') + "Z";
    var universalTime = moment(jsonOther.start);
    jsonOther.type = 1;
    jsonOther.status = 0;
    jsonOther.customerStatus = 0;
    jsonOther.locked = false;
    var d = new Date();
    var ticks = ((d.getTime() * 10000) + 621355968000000000) - 1234;
    jsonOther.id = ticks;
    jsonOther.posID = ticks.toString();

    jsonOther.foreignID = universalTime.unix() * 1000;
    Swal.fire(
        'Please Wait',
        'We are setting up your appointment...',
        'info',
    );
    if (!prepay) {
        chargeAmount = 0;
    }

    var url = "https://reports.appheaven.us/online/bookcbbnew.php";
    var merchantPhone = jsonMerchant.phoneNumber;
    if (jsonMerchant.reminderCfgs[0] != null && jsonMerchant.reminderCfgs[0].fromID != null) {
        merchantPhone = jsonMerchant.reminderCfgs[0].fromID;
    }

    var finalMsg = "{\"serviceBindings\":" + JSON.stringify(jsonArray) + "," + JSON.stringify(jsonOther).replace('\\', '').slice(1);
    console.log(finalMsg);
    var city = "";
    var state = "";
    var mer = merchantId + ":::" + jsonMerchant.authToken + ":::" + jsonMerchant.authURL + ":::"
        + jsonMerchant.timezone + ":::" + merchantPhone + ":::" + jsonMerchant.altName + ":::" + jsonMerchant.locale;
    if (holdpercent >= 100.0) {
        ccdata = ccdata + "1:::" + tipAmount;
        //url = "https://reports.appheaven.us/online/bookcbbnew.php";
    }
    //$customer = explode(':::', $customerdata); // 0X, 1firstname lastname, 2email, 3phone, 4X, 5X, 6X, 7address, 8X, 9X  
    var cus = "0:::" + firstName + " " + lastName + ":::" + emailAddress + ":::" + phoneNumber + ":::" + city + ":::" + state + ":::" + zip + ":::" + address + ":::" + note;
    // make the appointment bindings for all selected services
    if (merchantId == 'XB4ZVQ4MQKQ2R') { // all emails to one central email address
        employeeJSON[pickedEmployee].email = "mrnaturalzsalon@gmail.com";
    }
    var emp = employeeJSON[pickedEmployee].name + ":::" + employeeJSON[pickedEmployee].email + ":::" + jsonOther.foreignID + ":::" + totalDuration + ":::" + employeeJSON[pickedEmployee].posID;
    //1:::4154178615224557:::expmon:::expyear:::300:::76208:::3.5:::
    console.log(mer);
    console.log(cus);
    console.log(finalMsg);
    console.log(emp);
    console.log(ccdata);
    console.log(servicenames);
    $.post(url,
        {
            merchantdata: mer,
            customerdata: cus,
            // make the appointment bindings for all selected services
            appointmentchain: finalMsg,
            employeedata: emp,
            creditdata: ccdata,
            services: servicenames
        }).done(function (data, status) {
            if (data == "APPROVED") {
                lastAppt = jsonOther.posID + "=" + jsonOther.localStart + "=" + employeeJSON[pickedEmployee].name + "=" + employeeJSON[pickedEmployee].posID + "=" + employeeJSON[pickedEmployee].email + "=" + firstName + " " + lastName + "(phone " + phoneNumber + ")";
                localStorage.setItem("lastAppt" + merchantId, lastAppt);

                Swal.fire({
                    title: 'Confirmed. Thank you! [' + data + ']',
                    text: 'Please note your appointment is booked in the merchants timezone.',
                    showCancelButton: true,
                    icon: 'success',
                    confirmButtonText: 'Ok, thanks!',
                    denyButtonText: 'Cancel',
                }).then((result) => {
                    /* Read more about isConfirmed, isDenied below */
                    if (result.isConfirmed) {
                        Reset();
                        if (merchantId == 'PXHK1S2SQB0T1' || merchantId == 'EZHNVS95VVC6G') {
                            window.location.assign("https://blossomnglowbeautybar.com/pages/thankyou");
                        }
                        else if (merchantId == 'CQM2S598TAEB1') {
                            window.location.assign("https://www.elmaromatherapy.com/thank-you");
                        }
                        else {
                            // location.reload(true);
                            window.history.back();
                        }
                    } else if (result.isDenied) {
                        Reset();
                        if (merchantId == 'PXHK1S2SQB0T1' || merchantId == 'EZHNVS95VVC6G') {
                            window.location.assign("https://blossomnglowbeautybar.com/pages/thankyou");
                        }
                        else if (merchantId == 'CQM2S598TAEB1') {
                            window.location.assign("https://www.elmaromatherapy.com/thank-you");
                        }
                        else {
                            // location.reload(true);
                            window.history.back();
                        }
                    }
                });
            }
            else if (data == "FAILED") {
                Swal.fire({
                    title: 'Appointment not booked!',
                    text: "Your appointment at " + jsonOther.localStart + " was not available.  Someone just took that spot. Please try again.",
                    showCancelButton: true,
                    icon: 'error',
                    confirmButtonText: 'Ok, thanks!',
                    denyButtonText: 'Cancel',
                }).then((result) => {
                    /* Read more about isConfirmed, isDenied below */
                    if (result.isConfirmed) {
                        Reset();
                        location.reload(true);
                    } else if (result.isDenied) {
                        Reset();
                        location.reload(true);
                    }
                });
            }
            else if (data == "CUSTOMER") {
                Swal.fire({
                    title: 'Appointment not booked!',
                    text: "You already have an appointment booked with this salon. Please call the salon. Thank you.",
                    showCancelButton: true,
                    icon: 'error',
                    confirmButtonText: 'Ok, thanks!',
                    denyButtonText: 'Cancel',
                }).then((result) => {
                    /* Read more about isConfirmed, isDenied below */
                    if (result.isConfirmed) {
                        Reset();
                        location.reload(true);
                    } else if (result.isDenied) {
                        Reset();
                        location.reload(true);
                    }
                });
            }
            else {
                Swal.fire({
                    title: 'Appointment not booked! [' + data + ']',
                    text: "Please try again or call us immediately! Thank you.",
                    showCancelButton: true,
                    icon: 'error',
                    confirmButtonText: 'Ok, thanks!',
                    denyButtonText: 'Cancel',
                }).then((result) => {
                    /* Read more about isConfirmed, isDenied below */
                    if (result.isConfirmed) {
                        Reset();
                        location.reload(true);
                    } else if (result.isDenied) {
                        Reset();
                        location.reload(true);
                    }
                });
            }
            Reset();
        }); // end of .done
}

async function confirmAppointment() {
     if (haveCaptcha != 1) {
         Swal.fire("Recaptcha", "Please verify you are not a robot by checking the 'Im not a robot' box.");
         return;
     }
    if (!employeePicked) {
        Swal.fire("Please Select an Employee", "Please select an employee from the dropdown list");
        return;
    }
    if (!servicePicked) {
        Swal.fire("Please Select at Least One Service", "Please select at least one service from the dropdown list.");
        return;
    }
    if (!datePicked) {
        Swal.fire("Please Select Date.", "Please select date of appointment by tapping 'Pick Date'.");
        return;
    }
    if (!timePicked) {
        Swal.fire("Please Select Time", "Please select time of service.");
        return;
    }
    if (prepay && chargeAmount != 0 && !infogood) {
        Swal.fire("Card Information Error", "Please check your card information. Thank you.");
        return;
    }
    var len = selectedServices.length;
    if (len == 0) {
        Swal.fire("Please Select at least 1 Service", "We require at least one service to book this appointment.");
        return;
    }
    var note = "";
    var thisNote = "";
    note = document.getElementById("input-note").value;
    if (note != null && note.length > 1) {
        thisNote = note.replace(/\d+|^\s+|\s+$/g, '');
        console.log("note=" + thisNote);
        if (thisNote.length <= 1) {
            thisNote = "";
        }
    }

    var first = document.getElementById("input-first");
    console.log(first.value);
    if (!/^[a-zA-Z0-9 ][a-zA-Z0-9._\- ]*$/.exec(first.value)) {
        Swal.fire("Please Enter First Name", "We require a valid first name.");
        return;
    }
    var firstName = first.value.replace(/\x/g, '');
    firstName = firstName.replace(/\d+|^\s+|\s+$/g, '');
    if (firstName.length < 1) {
        Swal.fire("Browser Issue.", "We need to reload your page.");
        location.reload(true);
        return;
    }
    var last = document.getElementById("input-last");
    if (!/^[a-zA-Z0-9 ][ a-zA-Z0-9._\- ]*$/.exec(last.value)) {
        Swal.fire("Please Enter Last Name", "We require a valid last name with no special characters like apostrophes.");
        return;
    }
    var lastName = last.value.replace(/\x/g, '');
    lastName = lastName.replace(/\d+|^\s+|\s+$/g, '');
    if (lastName.length < 1) {
        Swal.fire("Browser Issue.", "We need to reload your page.");
        location.reload(true);
        return;
    }

    var email = document.getElementById("input-email");
    if (!validateEmail(email.value)) {
        Swal.fire("Please Provide Email Address", "We require a valid email.");
        return;
    }
    var emailAddress = email.value;
    if (emailAddress == "") {
        emailAddress = "no-email-provided@appheaven.com";
    }

    var phone = document.getElementById("input-phone");
    if (!/^[a-zA-Z0-9 ][ a-zA-Z0-9._\- ]*$/.exec(phone.value)) {
        Swal.fire("Please Provide Phone Number", "We require a valid mobile number.");
        return;
    }
    var phoneNumber = phone.value.replace(/\x/g, '');

    var address = "";
    var zip = "";
    if (showAddress > 0) {
        address = document.getElementById("input-address").value.replace(/\x/g, '-');
        zip = document.getElementById("input-zip").value.replace(/\x/g, '-');
    }

    var offset = -1 * moment().utcOffset();
    console.log("this browser offset:" + offset + " readying for time:" + thisTime);
    var mm = thisDateMoment.clone();
    var ccdata = "";
    mm.local().add({ minutes: thisTime });

    //
    var dstDate = false;
    var dayBeforeOrg = thisDateMoment.clone();
    var dayBefore = dayBeforeOrg.local().add({ days: -1 });
    console.log("DST mm:" + mm.isDST() + " daybefore:" + dayBefore.isDST());
    if (mm.isDST() == false && dayBefore.isDST() == true && mm.day() == 0) {
        console.log("this date is the day DST starts");
        dstDate = true;
        mm.add({ minutes: 60 });
    }
    else if (mm.isDST() == true && dayBefore.isDST() == false && mm.day() == 0) { // sunday
        console.log("this date is the day DST ends1x");
        mm.add({ minutes: -60 });
    }

    var titleString = "Book Appointment for " + mm.format(useFormatView) + "?\n" + confirmText;
    // if the deposit amount is 100%, then we also want to ask for a tip...
/*
    if (holdpercent >= 100.0) {
        tipAmount = 0;
        titleString = titleString + confirmstring;
        var ten = '10% (' + currencyFormat(chargeAmount * -.0010) + ')';
        var fifteen = '15% (' + currencyFormat(chargeAmount * -.0015) + ')';
        var twenty = '20% (' + currencyFormat(chargeAmount * -.0020) + ')';
        var twentyfive = '25% (' + currencyFormat(chargeAmount * -.0025) + ')';
        const { value: tipamt } = await Swal.fire({
            title: 'Select Tip Amount',
            input: 'select',
            inputOptions: {
                0: 'No thank you.',
                10: ten,
                15: fifteen,
                20: twenty,
                25: twentyfive
            },
            inputPlaceholder: 'Please Select Tip',
            showCancelButton: true,
            inputValidator: (value) => {
                return new Promise((resolve) => {
                    resolve()
                })
            }
        })

        console.log("tip amount:" + tipamt);

        if (tipamt > 0) {
            titleString = titleString + " [Tip:" + currencyFormat(chargeAmount * -tipamt / 10000.0) + "]";
            tipAmount = Math.ceil(chargeAmount * -tipamt / 100.0);
        }
    }
*/
    if (chargenow && holdpercent >= 100.0 && merchantId != '6ZP21FDYY3TB1') {
        tipAmount = 0 ;
        titleString = titleString + confirmstring;
        var ten = '10% (' + currencyFormat(chargeAmount * -.0010) + ')';
        var fifteen = '15% (' + currencyFormat(chargeAmount * -.0015) + ')';
        var twenty = '20% (' + currencyFormat(chargeAmount * -.0020) + ')';
        var twentyfive = '25% (' + currencyFormat(chargeAmount * -.0025) + ')';
        const { value: tipamt } = await Swal.fire({
            title: 'Select Tip Amount',
            input: 'select',
            inputOptions: {
                0: 'No thank you.',
                10: ten,
                15: fifteen,
                20: twenty,
                25: twentyfive
            },
            inputPlaceholder: 'Please Select Tip',
            showCancelButton: true,
            inputValidator: (value) => {
                return new Promise((resolve) => {
                    resolve()
                })
              }
        })

        console.log("tip amount:" + tipamt);

        if (tipamt > 0) {
            titleString = titleString + " [Tip:" + currencyFormat(chargeAmount * -tipamt/10000.0) + "]";
            tipAmount = Math.ceil(chargeAmount * -tipamt/100.0) ;
        }
    }

    Swal.fire({
        title: 'Are you sure?',
        text: titleString,
        icon: 'info',
        showDenyButton: false,
        showCancelButton: true,
        confirmButtonText: 'Book Me',
    }).then((result) => {
        /* Read more about isConfirmed, isDenied below */
        if (result.isConfirmed) {
            if (prepay && chargeAmount != 0) {
                clover.createToken().then(function (result) {
                    if (result.errors) {
                        console.log("ERRORS");
                        Swal.fire('Problem with Credit Card!', 'Please check your information or retry with another card', 'error');
                    } else {
                        console.log("Token:" + showProps(result.card, "res"));
                        if (result.card.brand == "AMEX" || result.card.brand == "DISCOVER") {
                            if (merchantId == 'GXRWYEJCPWGWT' && result.card.brand == "DISCOVER") { // allows discover
                            }
                            else if (!jsonMerchant.amex && result.card.brand == "AMEX" || !jsonMerchant.discover && result.card.brand == "DISCOVER") {
                                Swal.fire('Card Card Issue!', 'We dont accept American Express or Discover card. Please try again with another card. Thank you!', 'error');
                                return;

                            }
                        }
                        cloverChargeToken = result.token;
                        ccdata = prepay + ":::" + result.token + ":::" + chargeAmount + ":::" + result.card.last4 + ":::";
                        console.log("ccdata:" + ccdata);
                        BookNow(firstName, lastName, emailAddress, phoneNumber, address, zip, ccdata, thisNote);
                    }
                });
            }
            else {
                ccdata = prepay + ":::" + "NO CHARGE" + ":::" + 0 + ":::";
                BookNow(firstName, lastName, emailAddress, phoneNumber, address, zip, ccdata, thisNote);
            }
        }
        else if (result.isDenied) {
        }
    })
}

function showProps(obj, objName) {
    var result = ``;
    for (var i in obj) {
        //obj.hasOwnProperty() is used to filter out properties from the object's prototype chain
        if (obj.hasOwnProperty(i)) {
            result += `${objName}.${i} = ${obj[i]}\n`;
        }
    }
    return result;
}

function currencyFormat(num) {
    return currency + num.toFixed(2).replace(/(\d)(?=(\d{3})+(?!\d))/g, "$1,")
}

function timerIncrement() {
    idleTime = idleTime + 1;
    maxIdleTime = maxIdleTime + 1;
    if (idleTime <= 6 && maxIdleTime < 15) { // 10 minutes
        return;
    }
    Swal.fire({
        title: 'Timeout!',
        text: "You've been logged out due to inactivity.",
        showCancelButton: true,
        icon: 'success',
        confirmButtonText: 'Ok, thanks!',
        denyButtonText: 'Cancel',
    }).then((result) => {
        /* Read more about isConfirmed, isDenied below */
        if (result.isConfirmed) {
            Reset();
            location.reload(true);
        } else if (result.isDenied) {
            Reset();
            location.reload(true);
        }
    });
}

function DoesPickedEmployeeOfferThisService(servPOSID) {
    // if no employees offer a service, turn it off yyy
    h = pickedEmployee;
    // does the employee perform online?
    console.log("employee check:" + employeeJSON[h].name);
    if (!employeeJSON[h].performsOnlineServices) {
        console.log("employee doesn't perform online:" + employeeJSON[h].name);
        return 0;
    }
    //console.log("employee peforms online:" + employeeJSON[h].name);
    // does the employee offer ALL of the services that have been picked?
    var length = employeeJSON[h].serviceCfgs.length;
    for (var j = 0; j < length; j++) {
        var serviceObj = employeeJSON[h].serviceCfgs[j];
        if (serviceObj.posID == servPOSID) {
            if (serviceObj.offeredOnline && serviceObj.offered) { // found at least 1 service that is NOT offered by this employee that is required
                console.log("employee:" + employeeJSON[h].name + " offers this service online...:");
                return 1;
            }
        }
    }
    console.log("this employee doesn't offer this service online:" + servPOSID);
    return 0;
}

// when an employee changes, we need to load the appropriate services....
function employeeChanged(e) {
    pickedEmployee = $('#employee').val();
    console.log("got employee:" + pickedEmployee);
    if (pickedEmployee < 0) {
        return;
    }
    console.log("picked employee value:" + pickedEmployee);
    employeePicked = true;
    activeDate = [];

    // add all holidays
    hollen = holidays.length;
    var i = 0;
    for (i = 0; i < hollen; i++) {
        var date = new Date(holidays[i] * 1000);
        activeDate[date] = 1;
    }
    var elems = document.querySelector('.datepicker');
    var instance = M.Datepicker.init(elems, options);
    // show the timeslots for this employee...
    // if employee changes...then we need to clear the services picked....
    $(".timeslot").empty();
    if (datePicked) {
        inputField = document.getElementById("caleran");
        inputField.value = '';
        datePicked = false;
    }

    NewLoadServices();
    if (merchantId == 'ZY2HGYM0QA781') {
        document.getElementById("services").selectedIndex = -1;
        serviceDuration = 0;
        servicePicked = false;
        // $('select').formSelect();
        $('select:not(.swal2-select)').formSelect();
    }
    if (merchantId == '01XN24MC9YWZ1') {
        if (employeeJSON[pickedEmployee].name.includes("oncierge")) {
            Swal.fire({
                title: 'Attention!',
                icon: "warning",
                text: 'Price of the IV already includes the concierge fee of $50 for 1-20 miles away from our office, there could be an additional fee if the distance is greater than 21 miles. Add-ons are available.',
                confirmButtonText: 'OK, thanks!'
            });
        }
    }
}

function LoadEmployees() {
    console.log("Loading Employees...");
    // blank everything
    $(".employee").empty();
    // true because we picking the first employee
    employeePicked = true;
    //pickedEmployee = 0 ;
    pickedEmployee = -1;

    arrayLength = employeeJSON.length;
    // ignore all employees that don't perform online
    for (var i = 0; i < arrayLength; i++) {
        if (employeeJSON[i].hasOwnProperty('type') && employeeJSON[i].type == 1) {
            console.log("employee isn't visible online:" + employeeJSON[i].name);
            employeeJSON[i].performsOnlineServices = false;
            continue;
        }
        if (!employeeJSON[i].performsOnlineServices) {
            console.log("employee doesn't perform online:" + employeeJSON[i].name);
            continue;
        }
        if (pickedEmployee == -1) {
            pickedEmployee = i;
        }
        var name = employeeJSON[i].name;
        // special corrections if needed for merchants
        if (merchantId == 'V3QG8XQN3Z2KG') {
            if (name == "Michelle") {
                name = "MICHELE RAPOSA";
            }
            else if (name == "Saul") {
                name = "SAUL OROZCO";
            }
        }
        else if (merchantId == '5Q9GCX2V5X1R1') {
            if (name == "Aaron Duran") {
                name = "Aswift Luchini";
            }
            if (name == "Le##n Valencia") {
                name = "Leon Valencia";
            }
        }
        else if (merchantId == '1FCYENEGQNWV1') {
            if (name == "Miki Ashitani") {
                name = "Mia";
            }
        }
        if (jsonMerchant.useEmployeeNicknames) {
            name = employeeJSON[i].nickname;
            if (name == "NULL") {
                var names = employeeJSON[i].name.split(" ");
                if (names.length > 0) {
                    name = names[0];
                }
                else {
                    name = employeeJSON[i].name;
                }
            }
        }
        var newOption = new Option(name, i, false, false);
        $(".employee").append(newOption);
        console.log("Added EMPLOYEE:" + i + " " + name);
    }
    $('select:not(.swal2-select)').formSelect();
    // load services for the employee that was pre-picked
    NewLoadServices();
    if (merchantId == 'ZY2HGYM0QA781') {
        document.getElementById("services").selectedIndex = -1;
        serviceDuration = 0;
        servicePicked = false;
        $('select:not(.swal2-select)').formSelect();
    }
    return;
}

function FillEmployeesAndTimeSlots(displayPrompt) {
    if (!servicePicked && displayPrompt == 1) {
        Swal.fire("Select a service!", "Please select your services before choosing a date.");
        return -1;
    }
    startDayAppt = -1;
    endDayAppt = -1;
    // loop through all available employees
    var i = 0;
    earliestEmployeeTime = 9000; // max it out
    earliestEmployeeNumber = -1;

    if (!employeePicked) {
        return -1;
    }
    i = pickedEmployee;
    console.log("index=" + i);

    if (!employeeJSON[i].performsOnlineServices) {
        console.log("employee doesn't perform online:" + employeeJSON[i].name);
        return 0;
    }

    // does the employee offer ALL of the services that have been picked?
    var len = selectedServices.length;
    var offersAllServices = true;
    var employeeDuration = 0;
    for (var k = 0; k < len; k++) {
        var thisServiceIndex = selectedServices[k];
        var posID = serviceJSON[thisServiceIndex].posID;
        // check all employee services to see if this employee offers this service
        var length = employeeJSON[i].serviceCfgs.length;
        console.log("Found " + length + " Service");
        for (var j = 0; j < length; j++) {
            var serviceObj = employeeJSON[i].serviceCfgs[j];
            if (serviceObj.posID == posID) {
                if (!serviceObj.offeredOnline || !serviceObj.offered) { // found at least 1 service that is NOT offered by this employee that is required
                    offersAllServices = false;
                    break;
                }
                // go ahead and calculate the duration of the services for THIS employee
                else {
                    employeeDuration += ToMinutes(serviceObj.duration);
                    employeeDuration += ToMinutes(serviceObj.breakDuration);
                    if (serviceObj.hasOwnProperty('finish')) {
                        employeeDuration += serviceObj.finish;
                    }
                    console.log("employee duration for svc:" + employeeDuration);
                }
            }
        }
    }
    if (!offersAllServices) {
        console.log("employee doesn't offer ALL of the required services");
        // clear the date and the time slots
        // /jvp
        inputField = document.getElementById("caleran");
        inputField.value = '';
        datePicked = false;
        return 0;
    }
    // now we have to see if this employee has ANY timeslots available on the date that was selected

    // next fill in an array of available times for this employee for the chosen date
    FillTimeArray(i, employeeDuration);
    if (employeeTimeString[i].length < 3) { // date is bad...fill in on array
        $(".timeslot").empty();
        console.log("No times available for this employee");
        timePicked = false;
        var newOption = new Option("No timeslots available", 0, false, false);
        $('.timeslot').append(newOption);
        // $('select').formSelect();
        $('select:not(.swal2-select)').formSelect();
        inputField = document.getElementById("caleran");
        inputField.value = '';
        datePicked = false;
        return 0;
    }
    //  if they have at least one timeslot available, add them to list of possibilities... 
    if (servicePicked) { // check if all services and durations still match...
        DisplayTimeSlots(pickedEmployee);
    }
    //$('select').formSelect();
    if (displayPrompt == 1) {
        $('select:not(.swal2-select)').formSelect();
    }
    return 1;
}

async function getservices(ser) {
    var url = "https://reports.appheaven.us/online/getservices.php";
    var mer = merchantId + ":::" + jsonMerchant.authToken + ":::" + jsonMerchant.authURL + ":::" + jsonMerchant.timezone + ":::XXX:::XXX:::XXX";
    totalbasket = 0;
    console.log("checking basket:" + mer + " with services:" + ser);
    await $.post(url,
        {
            merchantdata: mer,
            servicedata: ser
        })
        .done(function (data, status) {
            if (data == "ERROR") {
                Swal.fire({
                    title: 'Error!',
                    text: 'Internet problem. Please try date again.',
                    showCancelButton: true,
                    icon: 'error',
                    confirmButtonText: 'Ok, thanks!',
                    denyButtonText: 'Cancel',
                }).then((result) => {
                    /* Read more about isConfirmed, isDenied below */
                    if (result.isConfirmed) {
                        Reset();
                        location.reload(true);
                    } else if (result.isDenied) {
                        Reset();
                        location.reload(true);
                    }
                });
            }
            else { // data is the total basket amount for all selected services
                totalbasket += data;
                console.log("basket total:" + totalbasket);
            }
        }); // end of .done
}

function setSelectedIndex(s, valsearch) {
    for (i = 0; i < s.options.length; i++) {
        if (s.options[i].value == valsearch) {
            s.options[i].selected = true;
            break;
        }
    }
    return;
}

function recaptchafunc(iresponse) {
     haveCaptcha = 1 ;
}

/*

    if (chargenow && holdpercent >= 100.0 && merchantId != '6ZP21FDYY3TB1') {
        tipAmount = 0 ;
        titleString = titleString + confirmstring;
        var ten = '10% (' + currencyFormat(chargeAmount * -.0010) + ')';
        var fifteen = '15% (' + currencyFormat(chargeAmount * -.0015) + ')';
        var twenty = '20% (' + currencyFormat(chargeAmount * -.0020) + ')';
        var twentyfive = '25% (' + currencyFormat(chargeAmount * -.0025) + ')';
        const { value: tipamt } = await Swal.fire({
            title: 'Select Tip Amount',
            input: 'select',
            inputOptions: {
                0: 'No thank you.',
                10: ten,
                15: fifteen,
                20: twenty,
                25: twentyfive
            },
            inputPlaceholder: 'Please Select Tip',
            showCancelButton: true,
            inputValidator: (value) => {
                return new Promise((resolve) => {
                    resolve()
                })
              }
        })

        console.log("tip amount:" + tipamt);

        if (tipamt > 0) {
            titleString = titleString + " [Tip:" + currencyFormat(chargeAmount * -tipamt/10000.0) + "]";
            tipAmount = Math.ceil(chargeAmount * -tipamt/100.0) ;
        }
    }
*/
