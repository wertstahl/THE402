/*
 _   _             ___  ____  ____ 
| | | |           /   |/ _  \/  _ \
| |_| |__   ___  / /| | |/' || |/' |
| __| '_ \ / _ \/ /_| |  /| ||  /| |
| |_| | | |  __/\___  | |_/ /\ |_/ /
 \__|_| |_|\___|    |_/\___/  \___/ 

__type: js
__version: 0.2
__authors: gandalf, LeDentist, Rego Sen
__propose: universal powers
__todo: die

*/

const RESHUFFLE_AFTER_ALL_LOOPS = true;
const LOOPS = [
  "379A_130_FOOSBARR",
  "380D_110_SLWDRP",
  "381A_105_DIGITHAL",
  "382D_107_FLUTI",
  "383A_123_DRGNSLAY",
  "384D_098_KLAPPER",
  "385A_193_CAPHEART",
  "386D_100_D34DCHIM",
  "387A_130_GHETBACK",
  "388D_140_HIRSCH",
  "389A_130_GOTSHALK",
  "390D_096_OGLOCAVE",
  "391A_210_EMILIONG",
  "392D_175_DACROWDS",
  "393A_143_LUKSUS",
  "394D_140_SLITE",
];
const LOOP_FORMAT = {
  ext: "wav",
  type: "audio/x-wav",
};

$(document).ready( function() {
  const audioContext = new AudioContext();
  const analyser = audioContext.createAnalyser();
  const gapless = new Gapless5('', {
    loop: false,
    singleMode: true,
  });
  // Fetches from 'file://...' are not supported
  // To run locally, call 'python -m http.server 8000' and visit http://localhost:8000
  if (window.location.protocol !== 'file:') {
    for (let i=0; i<LOOPS.length; i++) {
      const fileName = `${LOOPS[i]}.${LOOP_FORMAT.ext}`;
      const loopPath = `loops/${fileName}`;
      fetch(loopPath).then(response => response.blob())
      .then(blob => {
        const file = new File([blob], fileName, {type:LOOP_FORMAT.type});
        add_file_to_looplist(file);
      }).catch(err => console.error(err));
    }
  }
  // create audio element from audio element. 1 naise sache.
  const looper = document.querySelector('audio');
  // init track object for audio context as media element source
  const track = audioContext.createMediaElementSource(looper);
  track.connect(analyser);

  // silence loop
  const gainNode = audioContext.createGain();
  gainNode.gain.value = 0;
  gainNode.connect(audioContext.destination);
  analyser.connect(gainNode);

  analyser.minDecibels = -90;
  analyser.maxDecibels = -10;
  analyser.smoothingTimeConstant = 0.85;

  // define analyser canvas
  const canvas = document.querySelector('#loop-visualizer');
  const canvasCtx = canvas.getContext("2d");

  visualize();

  function visualize() {
    analyser.fftSize = 2048;
    const bufferLength = analyser.fftSize;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
      drawVisual = requestAnimationFrame(draw);

      analyser.getByteTimeDomainData(dataArray);

      canvasCtx.fillStyle = 'rgba(0,0,0,0)';
      canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

      canvasCtx.lineWidth = 2;
      canvasCtx.strokeStyle = 'rgba(255, 255, 255, 0.8)';

      canvasCtx.beginPath();

      const sliceWidth = canvas.width * 1.0 / bufferLength;
      let x = 0;

      for(let i = 0; i < bufferLength; i++) {

        const v = dataArray[i] / 128.0;
        const y = v * canvas.height/2;

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

  const get_next_mode = (mode) => {
    switch(mode) {
      case "none":
        return "all";
      case "all":
        return "one";
      default:
        return "none";
    }
   };

  // arm add-loop button
  $("button[target=add-loop]").off().on("click", () => {

    // trigger file-input to open file-dialog
    $("input[type=file]").trigger("click");

    // define file-input-element
    fileinput = $("#file-input");

    // when finished selecting file/s via file-dialog
    fileinput.off().on("change", (e) => {
      e.preventDefault();

      // iterate over files, push each one to looplist
      for (let i=0; i < fileinput[0].files.length; i++) {
        add_file_to_looplist(fileinput[0].files[i]);
      }
    });
  });

  // provide transport button events
  arm_looper_transport();

  // provide looper events
  arm_looper_events();

  // add files to looplist
  function add_file_to_looplist(file) {

    // first user interaction used to resume audio
    // https://developers.google.com/web/updates/2017/09/autoplay-policy-changes#webaudio
    audioContext.resume();

    // generate random GUID
    // don't hash the file name, because user might upload multiple files with same name
    const id = generate_uuidv4();

    // leave if md5 does not work
    if ($("#"+id).length > 0) return;

    // draw loop into list
    $("#loop-list").append("\
      <tr id='"+id+"'>\
        <td class='name'>"+file["name"]+"</td>\
        <td class='length'></td>\
        <td class='size' data="+file["size"]+">"+format_file_size(file["size"])+"</td>\
        <td class='type'>"+(file["type"]?(file["type"]):("<x style='color: orange'>unknown</x>"))+"</td>\
        <td class='options'>\
              <button target='play-loop'><i class='material-icons'>play_arrow</i></button>\
              <button target='remove-loop'><i class='material-icons'>clear</i></button>\
        </td>\
      </tr>");

    // put file object into loops attribute
    const blob = URL.createObjectURL(file);
    $("#"+id).attr("loop-blob", blob);

    gapless.addTrack(blob);

    // arm remove-loop button
    $("#"+id+" button[target=remove-loop]").off().on("click", () => {
      $(this).parent().parent().fadeOut("fast", () => { 
        const id = $(this).attr("id");
        const blob = $("#"+id).attr("loop-blob");
        gapless.removeTrack(blob);

        $(this).remove();
        loop_counter_callback();
      });
    });

    // arm button with click event
    arm_play_from_looplist(id);

    // update loops counter
    loop_counter_callback();
  }

  // handle ui play button state
  function arm_play_from_looplist(id) {
    $("#"+id+" button[target=play-loop]").off().on("click", () => {
      play_loop($(this).parent().parent().attr("id"), true);
    });
  }


  function arm_looper_events() {
    // set metadata
    looper.addEventListener('loadedmetadata', (e) => {
      loop = $("tr[loop-blob='"+looper.src+"']");
      loop.find(".length").text(String(Math.floor(looper.duration))+"s");
    });

    // provide progress bar
    looper.addEventListener("timeupdate", () => {
      const currentTime = looper.currentTime;
      const duration = looper.duration;
      el = $("#current-loop-time");
      // calculate negative duration
      clt = String(Math.floor((currentTime-duration)));
      // visualize ending by adding pulse animation to current-loop-time
      if (clt > -4 && !el.hasClass("ending")) { el.addClass("ending"); }
      else { el.removeClass("ending"); }
      // update current-loop-time text
      if (clt !== "NaN") $("#current-loop-time").text(clt+"s");
      // moving progress bar
      $("#current-loop-progress").stop(true,true).animate({'width':(currentTime +.25)/duration*100+'%'},200,'linear');
    });

    // remove playing attribute when loop ended
    gapless.onfinishedtrack = () => {
      loop = $("tr[loop-blob='"+looper.src+"']");
      reset_current_loop_progress();
      continuity(loop);
    };
  }

  function reset_current_loop_progress() {
    $("#loop-list tr[last=true]").removeAttr("last").removeAttr("playing");
    $("#loop-list button[target=play-loop] i").text("play_arrow");
    $("#current-loop-name").text("No loop playing...");
    $("#current-loop-time").text("").removeClass("ending");
    $("#loop-visualizer").fadeOut();
    $("#current-loop-progress").stop(true,true).animate({'width':'0%'},500,'linear');
  }

  // which loop is playing next
  function continuity(loop) {
    if (!loop) loop = $("#loop-list tr[last=true]");
    mode = $("button[target=repeat-loop-mode]").attr("mode");
    
    switch(mode) {

      // play all loops, try to find next,
      // if undefined, play first
      case "all":
        next = loop.nextAll().first().attr("id");
        if (next===undefined || !next) {
          next = $("#loop-list tr").first().attr("id");
          if (RESHUFFLE_AFTER_ALL_LOOPS && gapless.isShuffled()) {
            // re-shuffle at end of playlist
            shuffle_tracks();
          }
        }
        play_loop(next, false);
        break;

      // play same again
      case "one":
        next = loop.attr("id");
        play_loop(next, false);
        break;

      // play nothing
      case "none":
        return;
    }
  }

  function play_loop(id, playAudio) {
    loop = $("#"+id);
    
    looper.pause();
    $("#loop-list button[target=play-loop] i").text("play_arrow");
    $("#loop-list tr").not("#"+id).removeAttr("playing");

    // when nix is, dann make was. strict after lehrbook
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    const blob = $("#"+id).attr("loop-blob");
    // loop playing?
    if (loop.attr("playing") === undefined) {
      $("#loop-visualizer").fadeIn();
      looper.src = blob;
      looper.load();
      looper.play();
      if (playAudio) {
        gapless.gotoTrack(blob);
        gapless.play();
      }
      $("#loop-list tr").removeAttr("last");
      loop.attr("last", true); // the last loop played
      loop.attr("playing", true); // the current loop playing
      loop.find("button[target=play-loop] i").text("pause");
      $("#current-loop-name").text($(loop).find(".name").text());
    }
    // loop paused?
    else {
      if (loop.attr("playing") === "paused") {
        looper.play();
        if (playAudio) {
          gapless.play();
        }
        loop.attr("playing", true);
        loop.find("button[target=play-loop] i").text("pause");
        $("#loop-visualizer").fadeIn();
      }
      else {
        loop.attr("playing", "paused")
        looper.pause();
        if (playAudio) {
          gapless.pause();
        }
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

  function shuffle_tracks() {
    gapless.shuffle();
    gapless.gotoTrack(0); // this triggers the queued shuffle
  
    // get array of new indices
    $elements = $("#loop-list tr");
    const shuffled_elements = {};
    const count = $elements.length;
    for (let i = 0; i < count; i++) {
      const id = $elements.eq(i).attr("id");
      const blob = $("#"+id).attr("loop-blob");
      const new_index = gapless.findTrack(blob);
      shuffled_elements[new_index] = $elements.eq(i);
    }
    // apply new order to elements
    const $parent = $elements.parent();
    $elements.detach();
    for (i = 0; i < count; i++) {
      $parent.append( shuffled_elements[i] );
    }
  }

  // arm all buttons which belong into looper-transport
  function arm_looper_transport() {

    // clear/remove all loops
    $("#looper-transport button[target=clear-loops]").off().on("click", () => {
      $("#loop-list tr").remove();
      looper.pause();
      gapless.removeAllTracks();
      setTimeout(function() { 
        reset_current_loop_progress();
        loop_counter_callback();
      }, 10);
    });

    $("#looper-transport button[target=shuffle-loops]").off().on("click", () => {
      // TODO: get current play state and location and resume play after shuffle
      // const isPlaying = gapless.isPlaying();
      looper.pause();
      setTimeout(reset_current_loop_progress, 100);
      
      shuffle_tracks();
    });

    // arm repeat-loop-mode button
    $("button[target=repeat-loop-mode]").on("click", () => {
       const next_mode = get_next_mode($(this).attr("mode"));
       switch (next_mode) {
        case "none":
          gapless.loop = false;
          gapless.singleMode = true;
          $(this).find("i").text("repeat");
          $(this).attr("mode", "none");
          break;
        case "all":
          gapless.loop = true;
          gapless.singleMode = false;
          $(this).find("i").text("repeat");
          $(this).attr("mode", "all")
        break;
        case "one":
          gapless.loop = true;
          gapless.singleMode = true;
          $(this).find("i").text("repeat_one");
          $(this).attr("mode", "one");
        break;
      }
    });

    // stop playing loops, reset to play first next
    $("#looper-transport button[target=stop-playing-loops]").off().on("click", () => {
      looper.pause();
      gapless.stop();
      setTimeout(reset_current_loop_progress, 100);
    });

    // play all loops or play current one
    $("#looper-transport button[target=play-all-loops]").off().on("click", () => {
      gapless.gotoTrack(0);
      gapless.play();
      if ($("#loop-list tr[last=true]").length === 0) {
        play_loop($("#loop-list tr:first").attr("id"), true);
      }
      else {
        looper.play();
      }
    });
  }

  // return easy readable file sizes
  function format_file_size(bytes, si) {
    const thresh = si ? 1000 : 1024;
    if(Math.abs(bytes) < thresh) {
        return bytes + ' B';
    }
    const units = si
        ? ['kB','MB','GB','TB','PB','EB','ZB','YB']
        : ['KiB','MiB','GiB','TiB','PiB','EiB','ZiB','YiB'];
    let u = -1;
    do {
        bytes /= thresh;
        ++u;
    } while(Math.abs(bytes) >= thresh && u < units.length - 1);
    return bytes.toFixed(1)+' '+units[u];
  }
});

// from https://stackoverflow.com/questions/105034/how-to-create-a-guid-uuid
function generate_uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
