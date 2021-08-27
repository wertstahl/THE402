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

$(document).ready(() => {
  // options are low, med, high
  const queryParams = new URLSearchParams(window.location.search);
  const quality = queryParams.get('quality') || 'low';
  const LOOPS_REPOSITORY = `https://the400.wertstahl.de/${quality}`;
  const EXT_TO_TYPE = {
    wav: 'audio/x-wav',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    flac: 'audio/flac',
  };
  const maxLoops = parseInt(queryParams.get('maxLoops') || -1);

  const looperTransportButton = (target) => $(`#looper-transport button[target=${target}]`);
  const playAllButton = () => looperTransportButton("play-all-loops");

  const audioContext = new AudioContext();
  const analyser = audioContext.createAnalyser();
  const gapless = new Gapless5('', {
    loop: false, // we reshuffle at the end of the playlist instead
    singleMode: false,
    useHTML5Audio: false, // save memory
  });
  gapless.onload = (audio_path) => {
    if ($(`tr[loop-path="${audio_path}"]`).length > 0) {
      return;
    }
    
    const file_name = audio_path.replace(/^.*[\\\/]/, '');
    const ext = file_name.split('.')[1].toLowerCase();
    const mediaType = EXT_TO_TYPE[ext];
    fetch(audio_path).then((response) => response.blob())
      .then((blob) => {
        const file = new File([ blob ], file_name, { type:mediaType });
        add_file_to_looplist(file, audio_path);
      }).catch((err) => console.error(err));
  };
  const loop_state = { active: false };
  const loop_param = queryParams.get('loopRange');
  if (loop_param) {
    loop_state.active = true;
    const [loop_min, loop_max] = loop_param.split(',');
    loop_state.min = parseInt(loop_min);
    loop_state.max = parseInt(loop_max);
    console.log(`Setting loop range to {${loop_state.min}, ${loop_state.max}}`);
  }

  // Fetches from 'file://...' are not supported
  // To run locally, call 'python -m http.server 8000' and visit http://localhost:8000
  if (window.location.protocol !== 'file:') {
    const list_path = `${LOOPS_REPOSITORY}/list.txt`;
    fetch(list_path)
      .then((response) => response.text())
      .then((text) => {
        const loops = text.trim().split('\n');
        const num_loops = maxLoops >= 0 ? maxLoops : loops.length;
        const shuffled_loops = loops.map(a => ({ sort: Math.random(), value: a })).sort((a, b) => a.sort - b.sort).map(a => a.value);
        for (let i = 0; i < num_loops; i++) {
          const audio_path = `${LOOPS_REPOSITORY}/${shuffled_loops[i]}`;
          gapless.addTrack(audio_path);
        }
      })
      .catch(() => alert(`Failed to fetch list from ${list_path}`));
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

    const draw = function() {
      canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
      requestAnimationFrame(draw);

      analyser.getByteTimeDomainData(dataArray);

      canvasCtx.fillStyle = 'rgba(0,0,0,0)';
      canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

      canvasCtx.lineWidth = 2;
      canvasCtx.strokeStyle = 'rgba(255, 255, 255, 0.8)';

      canvasCtx.beginPath();

      const sliceWidth = Number(canvas.width) / bufferLength;
      let x = 0;

      for(let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = v * canvas.height / 2;

        if(i === 0) {
          canvasCtx.moveTo(x, y);
        } else {
          canvasCtx.lineTo(x, y);
        }

        x = x + sliceWidth;
      }

      canvasCtx.lineTo(canvas.width, canvas.height / 2);
      canvasCtx.stroke();
    };

    draw();
  }

  // provide transport button events
  arm_looper_transport();

  // provide looper events
  arm_looper_events();

  function get_loop() { return $(`tr[loop-blob='${looper.src}']`); }
  function last_loop() { return $("#loop-list tr[last=true]"); }

  // add files to looplist
  function add_file_to_looplist(file, audio_path) {
    // first user interaction used to resume audio
    // https://developers.google.com/web/updates/2017/09/autoplay-policy-changes#webaudio
    audioContext.resume();

    // generate random GUID
    // don't hash the file name, because user might upload multiple files with same name
    const id = generate_uuidv4();

    // leave if md5 does not work
    if ($(`#${id}`).length > 0) {
      return;
    }

    // draw loop into list
    // const [nr, bpm, name, _ext] = file.name.split(/[_\.]/);
    const name = file.name.split('.')[0];
    $("#loop-list").append(`
      <tr id='${id}'>
        <td class='options'><button target='play-loop'><i class='material-icons'>play_arrow</i></button></td>
        <td class='name'><button target='play-loop'>${name}</button></td>
        <td class='length'></td>
        <td class='size' data=${file.size}>${format_file_size(file.size)}</td>
        <td class='type'>${file.type ? file.type : "<x style='color: orange'>unknown</x>"}</td>
        <td class='options'>
          <button target='remove-loop'><i class='material-icons'>clear</i></button>
        </td>
      </tr>`);

    // put file object into loops attribute
    const blob = URL.createObjectURL(file);
    $(`#${id}`).attr("loop-blob", blob);
    $(`#${id}`).attr("loop-path", audio_path);

    // arm remove-loop button
    $(`#${id} button[target=remove-loop]`).off().on("click", function() {
      if (!$(this).hasClass("disabled")) {
        if ($(`#${id}`).attr("playing") === "true") {
          const loop = get_loop();
          if (loop.nextAll().length === 0) {
            // no next track, reshuffle and restart
            gapless.stop();
            shuffle_tracks();
            play_loop($("#loop-list tr").first().attr("id"), false);
          } else {
            // skip to next track if playing
            play_loop(loop.nextAll().first().attr("id"));
          }
        }
        $(this).parent().parent().fadeOut("fast", function() {
          gapless.removeTrack(audio_path);
          $(this).remove();
          loop_counter_callback();
        });
      }
    });

    // arm button with click event
    arm_play_from_looplist(id);

    // update loops counter
    loop_counter_callback();
  }

  // handle ui play button state
  function arm_play_from_looplist(id) {
    $(`#${id} button[target=play-loop]`).off().on("click", function() {
      play_loop($(this).parent().parent().attr("id"));
    });
  }

  function arm_looper_events() {
    // set metadata
    looper.addEventListener('loadedmetadata', () => {
      get_loop().find(".length").text(`${String(Math.floor(looper.duration))}s`);
    });

    // provide progress bar
    looper.addEventListener("timeupdate", () => {
      const currentTime = looper.currentTime;
      const duration = looper.duration;
      const el = $("#current-loop-time");
      // calculate negative duration
      const clt = String(Math.floor(currentTime - duration));
      // visualize ending by adding pulse animation to current-loop-time
      if (clt > -4 && !el.hasClass("ending")) {
        el.addClass("ending");
      } else {
        el.removeClass("ending");
      }
      // update current-loop-time text
      if (clt !== "NaN") {
        $("#current-loop-time").text(`${clt}s`);
      }
      // moving progress bar
      $("#current-loop-progress").stop(true, true).animate({ width:`${(currentTime + 0.25) / duration * 100}%` }, 200, 'linear');
    });

    // remove playing attribute when loop ended
    gapless.onfinishedtrack = function() {
      reset_current_loop_progress();
      continuity(get_loop());
    };
  }

  function enableButton(target, enable) {
    if (enable) {
      target.removeClass("disabled");
    } else {
      target.addClass("disabled");
    }
  };
  
  function enableTransportButton(target, enable) {
    enableButton(looperTransportButton(target), enable);
  };

  function reset_current_loop_progress() {
    enableButton($("button[target=remove-loop]"), true);
    last_loop().removeAttr("last").removeAttr("playing");
    $("#loop-list button[target=play-loop] i").text("play_arrow");
    playAllButton().find("i").text("play_arrow");
    $("#current-loop-name").text("No loop playing...");
    $("#current-loop-time").text("").removeClass("ending");
    $("#loop-visualizer").fadeOut();
    $("#current-loop-progress").stop(true, true).animate({ width:'0%' }, 500, 'linear');
    update_transport_buttons();
  }

  const get_hold_mode = () => $("button[target=hold-mode]").attr("hold") === "true";
  const get_loop_hold = () => loop_state.active && (loop_state.current < loop_state.last - 1);

  function reset_loop_state() {
    if (loop_state.active) {
      loop_state.last = loop_state.min + Math.floor(Math.random() * (loop_state.max - loop_state.min));
      loop_state.current = 0;
      gapless.singleMode = get_hold_mode() || get_loop_hold();
    } else {
      gapless.singleMode = get_hold_mode();
    }
    gapless.loop = gapless.singleMode;
  }

  // which loop is playing next
  function continuity(loop) {
    if (!loop) {
      loop = last_loop();
    }
    const hold_mode = get_hold_mode();
    let next = loop.attr("id");
    if (get_loop_hold()) {
      loop_state.current += 1;
      gapless.singleMode = hold_mode || get_loop_hold();
      gapless.loop = gapless.singleMode;
    } else if (!hold_mode) {
      next = loop.nextAll().first().attr("id");
      if (next === undefined) {
        // re-shuffle at end of playlist
        gapless.stop();
        shuffle_tracks();
        next = $("#loop-list tr").first().attr("id");
      }
      reset_loop_state();
    }
    play_loop(next, false);
  }

  function play_loop(id, playAudio = true) {
    if (id === undefined) {
      return;
    }
    const loop = $(`#${id}`);
    looper.pause();

    // when nix is, dann make was. strict after lehrbook
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    let paused = false;
    if (loop.attr("playing") === undefined) {
      // switching to a new track
      $("#loop-list button[target=play-loop] i").text("play_arrow");
      $("#loop-list tr").not(`#${id}`).removeAttr("playing");
      enableButton($("button[target=remove-loop]").not(`#${id}`), true);
      looper.src = loop.attr("loop-blob");
      looper.load();
      looper.play();
      if (playAudio) {
        reset_loop_state();
        gapless.gotoTrack(loop.attr("loop-path"));
        gapless.play();
      }
      $("#loop-list tr").removeAttr("last");
      loop.attr("last", true); // the last loop played
      $("#current-loop-name").text($(loop).find(".name").text());
    } else if (loop.attr("playing") === "paused") {
      // unpausing
      looper.play();
      if (playAudio) {
        gapless.play();
      }
    } else {
      // pausing
      paused = true;
      looper.pause();
      if (playAudio) {
        gapless.pause();
      }
    }

    if (paused) {
      $("#loop-visualizer").fadeOut();
    } else {
      $("#loop-visualizer").fadeIn();
    }
    loop.attr("playing", paused ? "paused" : true);
    playAllButton().find("i").text(paused ? "play_arrow" : "pause");
    loop.find("button[target=play-loop] i").text(paused ? "play_arrow" : "pause");
    enableButton($(`#${id} button[target=remove-loop]`), false);
    update_transport_buttons();
  }


  function update_transport_buttons() {
    if (last_loop().length > 0 && (!looper.paused || looper.currentTime > 0)) {
      // don't allow shuffle if a track is playing or paused
      enableTransportButton("shuffle-loops", false);
      enableTransportButton("clear-loops", false);
      enableTransportButton("stop-playing-loops", true);

      // disable prev/next based on if playing first or last track
      const loop = get_loop();
      const isPaused = loop.attr("playing") === "paused";
      enableTransportButton("prev-loop", !isPaused && loop.prevAll().length > 0);
      enableTransportButton("next-loop", !isPaused && loop.nextAll().length > 0);
    } else {
      // nothing is playing
      enableTransportButton("prev-loop", false);
      enableTransportButton("next-loop", false);
      enableTransportButton("shuffle-loops", true);
      enableTransportButton("clear-loops", true);
      enableTransportButton("stop-playing-loops", false);
    }
  }

  // update loop-counter and hide elements if not needed
  function loop_counter_callback() {
    $("#loops-counter").text($("#loop-list tr").length);
    if($("#loop-list tr").length > 0) {
      $("#introduction").hide();
      $("#loops-container").fadeIn();
      $("#looper-transport").fadeIn();
    } else {
      $("#loops-container").hide();
      $("#looper-transport").hide();
      $("#introduction").fadeIn();
    }
    update_transport_buttons();
  }

  function shuffle_tracks() {
    reset_loop_state();
    gapless.shuffle(false);
    gapless.gotoTrack(0); // this triggers the queued shuffle

    // get array of new indices
    const elements = $("#loop-list tr");
    const shuffled_elements = {};
    const count = elements.length;
    for (let i = 0; i < count; i++) {
      const id = elements.eq(i).attr("id");
      const audio_path = $(`#${id}`).attr("loop-path");
      const new_index = gapless.findTrack(audio_path);
      shuffled_elements[new_index] = elements.eq(i);
    }
    // apply new order to elements
    const $parent = elements.parent();
    elements.detach();
    for (let i = 0; i < count; i++) {
      $parent.append(shuffled_elements[i]);
    }
  }

  // arm all buttons which belong into looper-transport
  function arm_looper_transport() {
    // clear/remove all loops
    looperTransportButton("clear-loops").off().on("click", function() {
      if (!$(this).hasClass("disabled")) {
        $("#loop-list tr").remove();
        looper.pause();
        gapless.removeAllTracks();
        setTimeout(() => {
          reset_current_loop_progress();
          loop_counter_callback();
        }, 10);
      }
    });

    looperTransportButton("shuffle-loops").off().on("click", function() {
      if (!$(this).hasClass("disabled")) {
        looper.pause();
        setTimeout(reset_current_loop_progress, 100);

        shuffle_tracks();
        gapless.stop();
      }
    });

    // arm hold-mode button
    $("button[target=hold-mode]").on("click", function() {
      const holdNext = $(this).attr("hold") !== "true";
      if (holdNext) {
        $(this).find("i").text("repeat_one");
        $(this).attr("hold", "true");
      } else {
        $(this).find("i").text("repeat");
        $(this).attr("hold", "false");
      }
      reset_loop_state();
      update_transport_buttons();
    });

    // arm presets-mode button
    $("button[target=presets-mode]").on("click", function() {
      const preset = parseInt($(this).attr("preset"));
      const next = preset === 3 ? 0 : preset + 1;
      const icons = [
        "looks_one",
        "looks_two",
        "looks_3",
        "looks_4",
      ];
      $(this).find("i").text(icons[next]);
      $(this).attr("preset", next);
      // TODO: do something interesting with preset and next 
    });

    // stop and reset to start of current loop
    looperTransportButton("stop-playing-loops").off().on("click", function() {
      if (!$(this).hasClass("disabled")) {
        const loop = get_loop();
        if (loop.attr("playing") !== "paused") {
          play_loop(loop.attr("id"));
        }
        gapless.stop();
        looper.load();
        $("#current-loop-progress").stop(true, true).animate({ width:'0%' }, 500, 'linear');
        update_transport_buttons();
      }
    });

    // play all loops or play current one
    playAllButton().off().on("click", function() {
      if (last_loop().length === 0) {
        play_loop($("#loop-list tr:first").attr("id"));
      } else {
        play_loop(get_loop().attr("id"));
      }
    });

    // skip back (prev)
    looperTransportButton("prev-loop").off().on("click", function() {
      if (!$(this).hasClass("disabled")) {
        play_loop(get_loop().prevAll().first().attr("id"));
      }
    });

    // skip forward (next)
    looperTransportButton("next-loop").off().on("click", function() {
      if (!$(this).hasClass("disabled")) {
        play_loop(get_loop().nextAll().first().attr("id"));
      }
    });
  }

  // return easy readable file sizes
  function format_file_size(bytes, si) {
    const thresh = si ? 1000 : 1024;
    if(Math.abs(bytes) < thresh) {
      return `${bytes} B`;
    }
    const units = si ?
      [ 'kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB' ] :
      [ 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB' ];
    let u = -1;
    do {
      bytes = bytes / thresh;
      ++u;
    } while(Math.abs(bytes) >= thresh && u < units.length - 1);
    return `${bytes.toFixed(1)} ${units[u]}`;
  }
});

// from https://stackoverflow.com/questions/105034/how-to-create-a-guid-uuid
function generate_uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : r & 0x3 | 0x8;
    return v.toString(16);
  });
}
