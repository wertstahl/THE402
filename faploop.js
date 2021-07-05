/*

_|_|_|_|    _|_|    _|_|_|    _|          _|_|      _|_|    _|_|_|    
_|        _|    _|  _|    _|  _|        _|    _|  _|    _|  _|    _|  
_|_|_|    _|_|_|_|  _|_|_|    _|        _|    _|  _|    _|  _|_|_|    
_|        _|    _|  _|        _|        _|    _|  _|    _|  _|        
_|        _|    _|  _|        _|_|_|_|    _|_|      _|_|    _|

__type: js
__version: 0.1
__author: gandalf
__propose: universal powers
__todo: die

*/

$(document).ready( function() {

  // offer audio context old
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  // and new
  const audioContext = new AudioContext();
  
  var analyser = audioContext.createAnalyser();

  // create audio element from audio element. 1 naise sache.
  const looper = document.querySelector('audio');
  // init track object for audio context as media element source
  const track = audioContext.createMediaElementSource(looper);
  track.connect(analyser);
  // connect source to destination
  analyser.connect(audioContext.destination);
  analyser.minDecibels = -90;
  analyser.maxDecibels = -10;
  analyser.smoothingTimeConstant = 0.85;

  // define analyser canvas
  var canvas = document.querySelector('#loop-visualizer');
  var canvasCtx = canvas.getContext("2d");

  visualize();

  function visualize() {
    analyser.fftSize = 2048;
    var bufferLength = analyser.fftSize;
    console.log(bufferLength);
    var dataArray = new Uint8Array(bufferLength);

    var draw = function() {
      canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
      drawVisual = requestAnimationFrame(draw);

      analyser.getByteTimeDomainData(dataArray);

      canvasCtx.fillStyle = 'rgba(0,0,0,0)';
      canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

      canvasCtx.lineWidth = 2;
      canvasCtx.strokeStyle = 'rgba(255, 255, 255, 0.8)';

      canvasCtx.beginPath();

      var sliceWidth = canvas.width * 1.0 / bufferLength;
      var x = 0;

      for(var i = 0; i < bufferLength; i++) {

        var v = dataArray[i] / 128.0;
        var y = v * canvas.height/2;

        if(i === 0) {
          canvasCtx.moveTo(x, y);
        } else {
          canvasCtx.lineTo(x, y);
        }

        x += sliceWidth;
      }

      canvasCtx.lineTo(canvas.width, canvas.height/2);
      canvasCtx.stroke();
    };

    draw();
  }

  // arm add-loop button
  $("button[target=add-loop]").off().on("click", function() {

    // trigger file-input to open file-dialog
    $("input[type=file]").trigger("click");

    // define file-input-element
    fileinput = $("#file-input");

    // when finished selecting file/s via file-dialog
    fileinput.off().on("change", function(e) {
      e.preventDefault();

      // iterate over files, push each one to looplist
      for (var i=0; i < fileinput[0].files.length; i++) {
        add_file_to_looplist(fileinput[0].files[i]);
      }
    });
  });

  // provide transport button events
  arm_looper_transport();

  // provide looper events
  arm_looper_events();

  // provide cheap plugin boards
  arm_boards();


  function arm_boards() {
    // arm knobs
    $('.knob').Knob({
      minVal: 17,
      maxVal: 32,
      maxAng: 270,
      offsetAng: 135,
      initialValue: 0,
      initialPower: 1,
      onChange: function(elem, arguments) {
        
      },
      onPower: function(elem, arguments) {
        
      }
    });
  }

  // add files to looplist
  function add_file_to_looplist(file) {

    // first user interaction used to resume audio
    // https://developers.google.com/web/updates/2017/09/autoplay-policy-changes#webaudio
    audioContext.resume();

    // hash loop name for consistent matching
    hash = md5(file["name"]);

    // leave if md5 does not work
    if ($("#"+hash).length > 0) return;

    // draw loop into list
    $("#loop-list").append("\
      <tr id='"+hash+"'>\
        <td class='name'>"+file["name"]+"</td>\
        <td class='length'></td>\
        <td class='size' data="+file["size"]+">"+format_file_size(file["size"])+"</td>\
        <td class='type'>"+(file["type"]?(file["type"]):("<x style='color: orange'>unknown</x>"))+"</td>\
        <td class='options'>\
              <button target='play-loop'><i class='material-icons'>play_arrow</i></button>\
              <button target='skip-loop'><i class='material-icons'>redo</button>\
              <button target='remove-loop'><i class='material-icons'>clear</i></button>\
        </td>\
      </tr>");

    // put file object into loops attribute
    $("#"+hash).attr("loop-blob", URL.createObjectURL(file));

    // arm remove-loop button
    $("button[target=remove-loop]").on("click", function() {
      $(this).parent().parent().fadeOut("fast", function(){ $(this).parent().remove();
        loop_counter_callback();
      });
    });

    // arm button with click event
    arm_play_from_looplist(hash);

    // arm skip-loop-button
    $("#"+hash).find("button[target=skip-loop]").on("click", function() {
      el = $(this).parent().parent();
      if (el[0].hasAttribute("skip")) {
        $(this).removeClass("active");
        el.removeAttr("skip");
      }
      else {
        $(this).addClass("active");
        el.attr("skip", true);
      }
    });

    // update loops counter
    loop_counter_callback();
  }

  // handle ui play button state
  function arm_play_from_looplist(hash) {
    $("#"+hash+" button[target=play-loop]").off().on("click", function() {
      play_loop($(this).parent().parent().attr("id"));
    });
  }


  function arm_looper_events() {
    // set metadata
    looper.addEventListener('loadedmetadata', function(e) {
      loop = $("tr[loop-blob='"+looper.src+"']");
      loop.find(".length").text(String(Math.floor(looper.duration))+"s");
    });

    // provide progress bar
    looper.addEventListener("timeupdate", function() {
      var currentTime = looper.currentTime;
      var duration = looper.duration;
      el = $("#current-loop-time");
      // calculate negative duration
      clt = String(Math.floor((currentTime-duration)));
      // visualize ending by adding pulse animation to current-loop-time
      if (clt > -4 && !el.hasClass("ending")) { el.addClass("ending"); }
      else { el.removeClass("ending"); }
      // update current-loop-time text
      if (clt != "NaN") $("#current-loop-time").text(clt+"s");
      // moving progress bar
      $("#current-loop-progress").stop(true,true).animate({'width':(currentTime +.25)/duration*100+'%'},200,'linear');
    });

    // remove playing attribute when loop ended
    looper.addEventListener('ended', () => {
      $("#current-loop-time").text("");
      loop = $("tr[loop-blob='"+looper.src+"']");
      $("button[target=play-loop] i").text("play_arrow");
      $("#loop-list tr").removeAttr("playing");
      $("#loop-visualizer").fadeOut();
      reset_current_loop_progress();
      continuity(loop);
    }, false);
  }


  function reset_current_loop_progress() {
    $("#current-loop-progress").stop(true,true).animate({'width':'0%'},500,'linear');
  }

  // which loop is playing next
  function continuity(loop) {
    if (!loop) loop = $("#loop-list tr[last=true]");
    mode = $("button[target=repeat-loop-mode]").attr("mode");
    
    switch(mode) {

      // play all loops, try to find next not skippable one,
      // if undefined, play first which should not be skipped
      case "all":
        next = loop.nextAll().not("[skip=true]").first().attr("id");
        if (next===undefined || !next) {
          next = $("#loop-list tr").not("[skip=true]").first().attr("id");
        }
        play_loop(next);
        break;

      // play same again
      case "one":
        next = loop.attr("id");
        play_loop(next);
        break;

      // play nothing
      case "none":
        return;
    }
  }

  function play_loop(hash) {
    loop = $("#"+hash);
    
    looper.pause();
    $("#loop-list button[target=play-loop] i").text("play_arrow");
    $("#loop-list tr").not("#"+hash).removeAttr("playing");

    // when nix is, dann make was. strict after lehrbook
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }

    // loop playing?
    if (loop.attr("playing") === undefined) {
      $("#loop-visualizer").fadeIn();
      looper.src = $("#"+hash).attr("loop-blob");
      looper.load();
      looper.play();
      $("#loop-list tr").removeAttr("last");
      loop.attr("last", true); // the last loop played
      loop.attr("playing", true); // the current loop playing
      loop.find("button[target=play-loop] i").text("pause");
      $("#current-loop-name").text($(loop).find(".name").text());
    }
    // loop paused?
    else {
      if (loop.attr("playing") == "paused") {
        looper.play();
        loop.attr("playing", true);
        loop.find("button[target=play-loop] i").text("pause");
        $("#loop-visualizer").fadeOut();
      }
      else {
        loop.attr("playing", "paused")
        looper.pause();
        loop.find("button[target=play-loop] i").text("play_arrow");
        $("#loop-visualizer").fadeOut();
      }
    }
  }

  // update loop-counter and hide elements if not needed
  function loop_counter_callback(){
    $("#loops-counter").text($("#loop-list tr").length);
    if($("#loop-list tr").length > 0) {
      $("#introduction").hide();
      $("#loops-container").fadeIn();
      $("#looper-transport").fadeIn();
    }
    else {
      $("#loops-container").hide();
      $("#looper-transport").hide();
      $("#introduction").fadeIn();
    }
  }

  // arm all buttons which belong into looper-transport
  function arm_looper_transport() {

    // clear/remove all loops
    $("#looper-transport button[target=clear-loops]").off().on("click", function() {
      $("#loop-list tr").remove();
      setTimeout(function() { loop_counter_callback(); }, 10);
    });

    // shuffle loops, shuffling by caleb miller (https://codepen.io/MillerTime/pen/grZOBo)
    $("#looper-transport button[target=shuffle-loops]").off().on("click", function() {
      $elements = $("#loop-list tr");

      var i, index1, index2, temp_val;
      var count = $elements.length;
      var $parent = $elements.parent();
      var shuffled_array = [];

      // populate array of indexes
      for (i = 0; i < count; i++) {
        shuffled_array.push(i);
      }

      // shuffle indexes
      for (i = 0; i < count; i++) {
        index1 = (Math.random() * count) | 0;
        index2 = (Math.random() * count) | 0;
        temp_val = shuffled_array[index1];
        shuffled_array[index1] = shuffled_array[index2];
        shuffled_array[index2] = temp_val;
      }

      // apply random order to elements
      $elements.detach();
      for (i = 0; i < count; i++) {
        $parent.append( $elements.eq(shuffled_array[i]) );
      }
    });

    // arm repeat-loop-mode button
    $("button[target=repeat-loop-mode]").on("click", function() {
      mode = $(this).attr("mode");
      switch(mode) {
        case "none":
          $(this).find("i").text("repeat");
          $(this).attr("mode", "all")
        break;
        case "all":
          $(this).find("i").text("repeat_one");
          $(this).attr("mode", "one");
        break;
        case "one":
          $(this).find("i").text("repeat");
          $(this).attr("mode", "none");
        break;
      }
    });

    // stop playing loops, reset to play first next
    $("#looper-transport button[target=stop-playing-loops]").off().on("click", function() {
      looper.pause();
      setTimeout(function(){
        $("#loop-list tr[last=true]").removeAttr("last").removeAttr("playing");
        $("#loop-list button[target=play-loop] i").text("play_arrow");
        $("#current-loop-name").text("No loop playing...");
        $("#current-loop-time").text("").removeClass("ending");
        reset_current_loop_progress();
      }, 100);
    });

    // play all loops or play current one
    $("#looper-transport button[target=play-all-loops]").off().on("click", function() {
      if ($("#loop-list tr[last=true]").length == 0) {
        play_loop($("#loop-list tr:first").attr("id"));
      }
      else {
        looper.play();
      }
    });

    // show/hide boards 
    $("#looper-transport button[target=toggle-boards]").off().on("click", function(){
      if ($(this).hasClass("active")) {
        $(this).removeClass("active");
        $("#boards").fadeOut();
      }
      else {
        $(this).addClass("active");
        $("#boards").fadeIn();
      }
    });
  }

  // return easy readable file sizes
  function format_file_size(bytes, si) {
    var thresh = si ? 1000 : 1024;
    if(Math.abs(bytes) < thresh) {
        return bytes + ' B';
    }
    var units = si
        ? ['kB','MB','GB','TB','PB','EB','ZB','YB']
        : ['KiB','MiB','GiB','TiB','PiB','EiB','ZiB','YiB'];
    var u = -1;
    do {
        bytes /= thresh;
        ++u;
    } while(Math.abs(bytes) >= thresh && u < units.length - 1);
    return bytes.toFixed(1)+' '+units[u];
  }
});


(function ( $, window, document, undefined ) {

  var Knob = {
    init : function ( options, elem ) {
      var self = this;

      this.elem = elem;
      this.$elem = $( elem );

      // Defining local variables
      this.vars = {
        plugin :    this,
        rangeAng :  0,
        rangeVal :  0,
        value :     0,
        deg :       0,
        mouseDrag : false,
        timer :     null,
        lastVal :   0,

        knobControl : this.$elem.find( '.knob__control' ),
        knob :        this.$elem.find( '.knob__controlHandle' ),
        inputVal :    this.$elem.find( '.knob__value' )};

      // Overriding default options by user
      this.options = $.extend( {}, $.fn.Knob.options, options );

      // Calculating ranges
      this.vars.rangeAng = this.options.maxAng - this.options.minAng; // angle range
      this.vars.rangeVal = this.options.maxVal - this.options.minVal; // value range

      // Presetting values according to the template
      // INPUT
      if ( this.vars.inputVal && this.vars.inputVal.length > 0 ) {
        this.vars.inputVal.val( self.options.initialValue );
        self.rotateKnob();
      }


      self.events();
    },
      

    rotateKnob : function (e) {

      var value = e ? e.data.vars.inputVal.val() : this.vars.inputVal.val(),
          self = e ? e.data : this;

      if(!value) return 0;

      if ( value >= self.options.minVal && value <= self.options.maxVal ) {
        var percent = self.CalculatePercentage( value ),
            arc = self.ValueToDegree( percent );

        self.vars.knob.css( 'transform', 'rotate(' + arc + 'deg)' );

        self.vars.value = self.vars.inputVal.val();

        if ( self.vars.lastVal !== self.vars.value ) self.options.onChange( self.elem, [ {value : self.vars.value} ] );
        self.vars.lastVal = self.vars.value;

      }
    },

    CalculatePercentage : function ( value ) {
      return value != null ? 100 / this.vars.rangeVal * (value - this.options.minVal) / 100 : 100 / this.vars.rangeVal * (this.options.minVal - this.options.minVal);
    },

    ValueToDegree : function ( percentage ) {
      return this.options.minAng + this.options.offsetAng + (this.options.maxAng * percentage);
    },

    slideKnob : function ( e ) {

      var self = e ? e.data : this;

      var page = {};
      if ( e.originalEvent.touches ) {
        page = {
          x : e.originalEvent.touches[ 0 ].pageX,
          y : e.originalEvent.touches[ 0 ].pageY
        }
      } else {
        if ( self.vars.mouseDrag ) {
          page = {
            x : e.pageX,
            y : e.pageY
          };

        }
      }


      var x = (self.$elem.width() / 2) - page.x + self.$elem.offset().left, // cursor X
          y = (self.$elem.height() / 2) - page.y + self.$elem.offset().top, // cursor Y
          percent;

      self.vars.deg = (Math.atan2( -y, -x ) * 180 / Math.PI) - self.options.offsetAng; // Degrees in Radians

      // if degrees lower than 0 then add up
      if ( self.vars.deg < 0 ) {
        self.vars.deg += 360;
      }
      self.vars.deg = self.vars.deg % 360;

      if ( self.vars.deg <= self.vars.rangeAng ) {
        percent = Math.max( Math.min( 1, self.vars.deg / self.vars.rangeAng ), 0 );
      } else {
        percent = +(self.vars.deg - self.vars.rangeAng < (360 - self.vars.rangeAng) / 2);
      }

      // end value ( to be set in input element)
      self.vars.value = self.options.minVal + self.vars.rangeVal * percent;

      if ( (self.vars.deg >= self.options.minAng) && (self.vars.deg <= self.options.maxAng) ) {

        self.vars.knob.css( 'transform', 'rotate(' + (self.vars.deg + self.options.offsetAng) + 'deg)' );
        self.vars.inputVal.val( self.vars.value.toFixed( 1 ) );

      }
    },

    getValue : function () {

      if(!this.vars.value) return 0;

      if ( this.options.decimal ) {
        this.vars.value.toFixed( 1 );
      }
      else {
        this.vars.value = parseInt( this.vars.value );
      }
      return this.vars.value;
    },

    events : function () {
      var self = this;

      self.$elem.on( 'mousemove touchmove', self, self.slideKnob );

      self.vars.knob
        .on( 'mousedown touchstart', function () {

          self.vars.mouseDrag = true;

          self.vars.timer = setInterval( function () {

            if ( self.vars.lastVal !== self.vars.value ) self.options.onChange( self.elem, [ {value : self.getValue()} ] );
            self.vars.lastVal = self.vars.value;

          }, self.options.interval );
        } )
        .on( 'mouseup touchend', function () {

          self.vars.mouseDrag = false;
          clearInterval( self.vars.timer );

        } );

      if ( self.vars.inputVal.length > 0 ) {
        self.vars.inputVal.on( 'blur', self, self.rotateKnob );

        if ( self.vars.lastVal !== self.vars.value ) self.options.onChange( self.elem, [ {value : self.getValue()} ] );
        self.vars.lastVal = self.vars.value;
      }
    }

  };



  // Registering plugin with jQuery
  $.fn.Knob = function ( options ) {
    return this.each( function () {
      var knob = Object.create( Knob );
      knob.init( options, this );

      $.data( this, 'Knob', knob );
    } );
  };

  // Plugin options
  $.fn.Knob.options = {
    initialValue : 20,
    minVal :       17,
    maxVal :       32,
    minAng :       0,
    maxAng :       300,
    offsetAng :    120,
    interval :     200,
    decimal :      true,

    onChange : function () {
    },
    onResize : function () {
    },
    onPower :  function () {
    }
  };

})( jQuery, window, document );







/* MD5 IMPLEMENTATION FROM JOSEPH MYER (http://www.myersdaily.org/joseph/javascript/md5-text.html) */
function md5cycle(x, k) {
var a = x[0], b = x[1], c = x[2], d = x[3];

a = ff(a, b, c, d, k[0], 7, -680876936);
d = ff(d, a, b, c, k[1], 12, -389564586);
c = ff(c, d, a, b, k[2], 17,  606105819);
b = ff(b, c, d, a, k[3], 22, -1044525330);
a = ff(a, b, c, d, k[4], 7, -176418897);
d = ff(d, a, b, c, k[5], 12,  1200080426);
c = ff(c, d, a, b, k[6], 17, -1473231341);
b = ff(b, c, d, a, k[7], 22, -45705983);
a = ff(a, b, c, d, k[8], 7,  1770035416);
d = ff(d, a, b, c, k[9], 12, -1958414417);
c = ff(c, d, a, b, k[10], 17, -42063);
b = ff(b, c, d, a, k[11], 22, -1990404162);
a = ff(a, b, c, d, k[12], 7,  1804603682);
d = ff(d, a, b, c, k[13], 12, -40341101);
c = ff(c, d, a, b, k[14], 17, -1502002290);
b = ff(b, c, d, a, k[15], 22,  1236535329);

a = gg(a, b, c, d, k[1], 5, -165796510);
d = gg(d, a, b, c, k[6], 9, -1069501632);
c = gg(c, d, a, b, k[11], 14,  643717713);
b = gg(b, c, d, a, k[0], 20, -373897302);
a = gg(a, b, c, d, k[5], 5, -701558691);
d = gg(d, a, b, c, k[10], 9,  38016083);
c = gg(c, d, a, b, k[15], 14, -660478335);
b = gg(b, c, d, a, k[4], 20, -405537848);
a = gg(a, b, c, d, k[9], 5,  568446438);
d = gg(d, a, b, c, k[14], 9, -1019803690);
c = gg(c, d, a, b, k[3], 14, -187363961);
b = gg(b, c, d, a, k[8], 20,  1163531501);
a = gg(a, b, c, d, k[13], 5, -1444681467);
d = gg(d, a, b, c, k[2], 9, -51403784);
c = gg(c, d, a, b, k[7], 14,  1735328473);
b = gg(b, c, d, a, k[12], 20, -1926607734);

a = hh(a, b, c, d, k[5], 4, -378558);
d = hh(d, a, b, c, k[8], 11, -2022574463);
c = hh(c, d, a, b, k[11], 16,  1839030562);
b = hh(b, c, d, a, k[14], 23, -35309556);
a = hh(a, b, c, d, k[1], 4, -1530992060);
d = hh(d, a, b, c, k[4], 11,  1272893353);
c = hh(c, d, a, b, k[7], 16, -155497632);
b = hh(b, c, d, a, k[10], 23, -1094730640);
a = hh(a, b, c, d, k[13], 4,  681279174);
d = hh(d, a, b, c, k[0], 11, -358537222);
c = hh(c, d, a, b, k[3], 16, -722521979);
b = hh(b, c, d, a, k[6], 23,  76029189);
a = hh(a, b, c, d, k[9], 4, -640364487);
d = hh(d, a, b, c, k[12], 11, -421815835);
c = hh(c, d, a, b, k[15], 16,  530742520);
b = hh(b, c, d, a, k[2], 23, -995338651);

a = ii(a, b, c, d, k[0], 6, -198630844);
d = ii(d, a, b, c, k[7], 10,  1126891415);
c = ii(c, d, a, b, k[14], 15, -1416354905);
b = ii(b, c, d, a, k[5], 21, -57434055);
a = ii(a, b, c, d, k[12], 6,  1700485571);
d = ii(d, a, b, c, k[3], 10, -1894986606);
c = ii(c, d, a, b, k[10], 15, -1051523);
b = ii(b, c, d, a, k[1], 21, -2054922799);
a = ii(a, b, c, d, k[8], 6,  1873313359);
d = ii(d, a, b, c, k[15], 10, -30611744);
c = ii(c, d, a, b, k[6], 15, -1560198380);
b = ii(b, c, d, a, k[13], 21,  1309151649);
a = ii(a, b, c, d, k[4], 6, -145523070);
d = ii(d, a, b, c, k[11], 10, -1120210379);
c = ii(c, d, a, b, k[2], 15,  718787259);
b = ii(b, c, d, a, k[9], 21, -343485551);

x[0] = add32(a, x[0]);
x[1] = add32(b, x[1]);
x[2] = add32(c, x[2]);
x[3] = add32(d, x[3]);

}

function cmn(q, a, b, x, s, t) {
a = add32(add32(a, q), add32(x, t));
return add32((a << s) | (a >>> (32 - s)), b);
}

function ff(a, b, c, d, x, s, t) {
return cmn((b & c) | ((~b) & d), a, b, x, s, t);
}

function gg(a, b, c, d, x, s, t) {
return cmn((b & d) | (c & (~d)), a, b, x, s, t);
}

function hh(a, b, c, d, x, s, t) {
return cmn(b ^ c ^ d, a, b, x, s, t);
}

function ii(a, b, c, d, x, s, t) {
return cmn(c ^ (b | (~d)), a, b, x, s, t);
}

function md51(s="") {
txt = '';
var n = s.length,
state = [1732584193, -271733879, -1732584194, 271733878], i;
for (i=64; i<=s.length; i+=64) {
md5cycle(state, md5blk(s.substring(i-64, i)));
}
s = s.substring(i-64);
var tail = [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0];
for (i=0; i<s.length; i++)
tail[i>>2] |= s.charCodeAt(i) << ((i%4) << 3);
tail[i>>2] |= 0x80 << ((i%4) << 3);
if (i > 55) {
md5cycle(state, tail);
for (i=0; i<16; i++) tail[i] = 0;
}
tail[14] = n*8;
md5cycle(state, tail);
return state;
}
function md5blk(s) { /* I figured global was faster.   */
var md5blks = [], i; /* Andy King said do it this way. */
for (i=0; i<64; i+=4) {
md5blks[i>>2] = s.charCodeAt(i)
+ (s.charCodeAt(i+1) << 8)
+ (s.charCodeAt(i+2) << 16)
+ (s.charCodeAt(i+3) << 24);
}
return md5blks;
}

var hex_chr = '0123456789abcdef'.split('');

function rhex(n)
{
var s='', j=0;
for(; j<4; j++)
s += hex_chr[(n >> (j * 8 + 4)) & 0x0F]
+ hex_chr[(n >> (j * 8)) & 0x0F];
return s;
}

function hex(x) {
for (var i=0; i<x.length; i++)
x[i] = rhex(x[i]);
return x.join('');
}

function md5(s) {
return hex(md51(s));
}

function add32(a, b) {
return (a + b) & 0xFFFFFFFF;
}

if (md5('hello') != '5d41402abc4b2a76b9719d911017c592') {
function add32(x, y) {
var lsw = (x & 0xFFFF) + (y & 0xFFFF),
msw = (x >> 16) + (y >> 16) + (lsw >> 16);
return (msw << 16) | (lsw & 0xFFFF);
}
}