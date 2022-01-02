/*
THE402 (c) 2008 - 2022 SyS Audio Research
__type: js
__version: 0.4
__author: Rego Sen
__additional-code: D. Zahn
__additional-code: S. I. Hartmann
*/

$(document).ready(() => {
  // CONSTANTS
  const WAVES_IN_WINDOW = 100; // number of peak+vally square waves in canvas
  const SAMPLES_IN_WINDOW = 1024; // number of samples represented in canvas
  const LICENSE_MESSAGE = "You are welcome to use this loop in a non-commercial fashion, royalty free, after getting written permission by sending an email to info@battlecommand.org";
  
  const LOOPS_REPOSITORY = 'https://the402.wertstahl.de';
  const EXT_TO_TYPE = {
    wav: 'audio/x-wav',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    flac: 'audio/flac',
  };
  const PLAYLIST_FILTERS = {
    'select1': '',
    'select2': /\d+D_.*/,
    'select3': /\d+A_.*/,
  }
  const HOLD_MODES = [
    [2, 4], // RND: 2-4
    [1, 8], // RND (1-8)
    [0, 0], // Hold single loop
    [1, 1], // No hold (play each loop once)
  ];

  // CONFIG
  const queryParams = new URLSearchParams(window.location.search); // low, med, high
  const quality = queryParams.get('quality') || 'low';
  const maxLoops = parseInt(queryParams.get('maxLoops') || -1);
  const loadLimit = parseInt(queryParams.get('loadLimit') || 5);

  // UTILITIES
  const toFilename = (path) => path.replace(/^.*[\\\/]/, '');
  const looperTransportButton = (target) => $(`.looper-transport button[target=${target}]`);
  const getLoopsPath = (path) => `${LOOPS_REPOSITORY}/${quality}/${path}`;

  // SELECTORS
  const sequenceIndicator = document.querySelector('#loop-sequence');
  const looper = document.querySelector('audio');

  // STATE
  let playOnLoad = false;
  const loadedAudio = {}; // for visualizer, downloads, enabling prev/next, etc.
  const loopState = { forever: false, min: 1, max: 1 };
  const getLoopHold = () => loopState.forever || (loopState.current < loopState.last - 1);
  const getLoopsRemaining = () => loopState.forever ? -1 : (loopState.last - loopState.current);

  // CONTEXTS
  // A wrapper for 2 Gapless5 players to cross-fade between tracks, etc
  function Gapless5Wrapper(inLoadLimit) {
    const gaplessOptions = {
      loop: false, // we handle looping ourselves, so that we can re-shuffle beforehand
      singleMode: false,
      useHTML5Audio: false, // save memory
      loadLimit: inLoadLimit,
      shuffle: false, // we handle (re-)shuffling ourselves
      logLevel: LogLevel.Info, // LogLevel.Debug,
    };
    const players = [
      new Gapless5(gaplessOptions), // even tracks
      new Gapless5(gaplessOptions), // odd tracks
    ];

    let tempo = 0; // use whatever first track you play
    const getTempo = (audioPath) => toFilename(audioPath).split('.')[0].split('_')[1] * 1;

    let index = 0;

    this.current = () => players[index % 2];
    this.standby = () => players[(index + 1) % 2];
    this.forEach = (func) => {
      players.forEach(player => func(player));
    };
    this.onfinishedtrack = () => {};
    this.numTracks = () => this.current().getTracks().length;
    this.getPlaybackRate = (track) => tempo / getTempo(track.currentSource().audioPath);

    this.gotoTrack = (audioPath) => {
      if (tempo === 0) {
        tempo = getTempo(audioPath);
      }
      index = players[0].findTrack(audioPath);
      const currentTrack = this.current();
      currentTrack.gotoTrack(index);
      currentTrack.setPlaybackRate(this.getPlaybackRate(currentTrack));
      currentTrack.setVolume(1);
      currentTrack.onfinishedtrack = this.onfinishedtrack;

      const standbyTrack = this.standby();
      standbyTrack.gotoTrack((index + 1) % this.numTracks());
      standbyTrack.setPlaybackRate(this.getPlaybackRate(standbyTrack));
      standbyTrack.setVolume(0);
      standbyTrack.onfinishedtrack = () => {};
    };

    this.onStartedTrack = (repsLeft) => {
      if (repsLeft === 1) {
        const currentTrack = this.current();
        const standbyTrack = this.standby();
        const duration = currentTrack.currentSource().getDuration() / this.getPlaybackRate(currentTrack);
        const duration2 = standbyTrack.currentSource().getDuration() / this.getPlaybackRate(standbyTrack);
        currentTrack.setVolume(0, duration);
        standbyTrack.setVolume(1, duration2);
      }
    }
  };
  const gapless = new Gapless5Wrapper(loadLimit);

  // CONTEXT UTILITIES
  const getLoop = (offset = 0) => gapless.current().getTracks()[gapless.current().getIndex() + offset];
  const getPrev = () => getLoop(-1);
  const getNext = () => getLoop(1);
  setHoldMode(0);
  
  gapless.forEach(player => player.onloadstart = (audioPath) => {
    const fileName = toFilename(audioPath);
    const ext = fileName.split('.')[1].toLowerCase();
    const mediaType = EXT_TO_TYPE[ext];
    fetch(audioPath).then((response) => response.blob())
    .then((blob) => {
      const file = new File([ blob ], fileName, { type: mediaType });
      const blobURL = URL.createObjectURL(file);
      loadedAudio[audioPath] = blobURL;
      updateTransportButtons();
      if (playOnLoad && audioPath === gapless.current().getTracks()[0]) {
        playOnLoad = false;
        playLoop(audioPath);
      }
    }).catch((err) => console.error(err));
  });
  gapless.forEach(player => player.onload = () => {
    updateTransportButtons();
  });
  gapless.forEach(player => player.onunload = (audioPath) => {
    URL.revokeObjectURL(loadedAudio[audioPath]);
    delete loadedAudio[audioPath];
  });
  
  gapless.forEach(player => player.onfinishedtrack = () => {
    resetCurrentLoopProgress();
    continuity(getLoop());
  });

  // Local audio context for visualizer and progress bar
  const audioContext = new AudioContext();
  const analyser = function() {
    const analyserNode = audioContext.createAnalyser();
    const track = audioContext.createMediaElementSource(looper);
    track.connect(analyserNode);

    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0;
    gainNode.connect(audioContext.destination);
    analyserNode.connect(gainNode);
    analyserNode.fftSize = SAMPLES_IN_WINDOW;
    return analyserNode;
  }();

  function buildLoops() {
    const filterMode = $('#filter-selection').attr('mode');
    const filterRegex = PLAYLIST_FILTERS[filterMode];

    // Fetches from 'file://...' are not supported
    // To run locally, call 'python -m http.server 8000' and visit http://localhost:8000
    if (window.location.protocol !== 'file:') {
      const listPath = getLoopsPath('list.txt');
      fetch(listPath)
        .then((response) => response.text())
        .then((text) => {
          const orderedLoops = text.trim().split('\n');
          const loops = orderedLoops.map(a => ({ sort: Math.random(), value: a })).sort((a, b) => a.sort - b.sort).map(a => a.value);
          const numLoops = maxLoops >= 0 ? maxLoops : loops.length;
          for (let i = 0; i < numLoops; i++) {
            if (loops[i].match(filterRegex)) {
              const audioPath = getLoopsPath(loops[i]);
              gapless.forEach(player => player.addTrack(audioPath));
            }
          }
        })
        .catch(() => alert(`Failed to fetch list from ${listPath}`));
    }
  }
  buildLoops();
  
  // define analyser canvas
  function visualize() {
    const canvas = document.querySelector('#loop-visualizer');
    const canvasCtx = canvas.getContext("2d");

    const bufferLength = analyser.fftSize;
    const arrayBuffer = new Uint8Array(bufferLength);

    const filterData = rawData => {
      const blockSize = Math.floor(rawData.length / WAVES_IN_WINDOW); // the number of samples in each subdivision
      const filteredData = [];
      for (let i = 0; i < WAVES_IN_WINDOW; i++) {
        let blockStart = blockSize * i; // the location of the first sample in the block
        let sum = 0;
        for (let j = 0; j < blockSize; j++) {
          sum = sum + Math.abs(rawData[blockStart + j]) // find the sum of all the samples in the block
        }
        filteredData.push(sum / blockSize); // divide the sum by the block size to get the average
      }
      return filteredData;
    }
  
    const normalizeData = filteredData => {
      const multiplier = Math.pow(Math.max(...filteredData), -1);
      return filteredData.map(n => n * multiplier);
    }    
    
    const drawLineSegment = (ctx, x, y, width, isEven) => {
      ctx.lineWidth = 1; // how thick the line is
      ctx.strokeStyle = "#000"; // what color our line is
      ctx.beginPath();
      y = isEven ? y : -y;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, y);
      ctx.arc(x + width / 2, y, width / 2, Math.PI, 0, isEven);
      ctx.lineTo(x + width, 0);
      ctx.stroke();
    };
  
    const draw = () => {
      requestAnimationFrame(draw);
      const canvasState = $('#loop-visualizer');
      canvas.width = canvasState.width();
      canvas.height = canvasState.height();
      canvasCtx.translate(0, canvas.height / 2); // Set Y = 0 to be in the middle of the canvas
      canvasCtx.scale(1, 0.5); // give it some vertical padding
  
      analyser.getByteTimeDomainData(arrayBuffer);
      const filteredData = filterData(arrayBuffer);
      const normalizedData = normalizeData(filteredData);
      
      // draw the line segments
      canvasCtx.clearRect(0, -canvas.height/2, canvas.width, canvas.height);
      const width = canvas.width / normalizedData.length;
      const height = canvas.height / 2;
      for (let i = 0; i < normalizedData.length; i++) {
        const x = width * i;
        const y = height * normalizedData[i];
        drawLineSegment(canvasCtx, x, y, width, (i + 1) % 2);
      }
    };
    draw();
  }
  visualize();

  // provide transport button events
  armLooperTransport();

  // provide looper events
  armLooperEvents();
  
  function armLooperEvents() {
    // provide progress bar
    looper.addEventListener("timeupdate", () => {
      const { currentTime, duration } = looper;
      if (currentTime === 0) {
        $("#loop-progress").stop(true, true).animate({ width:'0%' }, 10, 'linear');
      } else {
        $("#loop-progress").stop(true, true).animate({ width:`${100.0 * (currentTime + 0.4) / duration }%` }, 200, 'linear');
      }
    });
  }
  
  function enableTransportButton(target, enable) {
    if (enable) {
      looperTransportButton(target).removeClass("disabled");
    } else {
      looperTransportButton(target).addClass("disabled");
    }
  };

  function resetCurrentLoopProgress() {
    $("button[target=remove-loop]").removeClass("disabled");
    looperTransportButton("play-pause").attr("mode", "play");
    $("#loop-name").text("");
    $("#loop-tempo").text("");
    $("#loop-progress").stop(true, true).animate({ width:'0%' }, 10, 'linear');
    updateTransportButtons();
    updateSequenceIndicator();
  }
  
  function updateSequenceIndicator() {
    sequenceIndicator.replaceChildren([]);
    if (!loopState.forever) {
      for (i=0; i<loopState.last; i++) {
        const ball = document.createElement('div');
        const hasPlayed = i >= (loopState.last - loopState.current);
        ball.className = 'loop-sequence-indicator';
        ball.setAttribute('mode', hasPlayed ? 'played' : 'unplayed')
        sequenceIndicator.appendChild(ball);
      }
    }
  }

  function resetLoopState() {
    if (loopState.forever) {
      gapless.forEach((player) => { player.singleMode = true });
    } else {
      loopState.last = loopState.min + Math.round(Math.random() * (loopState.max - loopState.min));
      loopState.current = 0;
      gapless.forEach((player) => { player.singleMode = getLoopHold() });
    }
    gapless.forEach((player) => { player.loop = player.singleMode });
    updateSequenceIndicator();
  }
  resetLoopState();

  // which loop is playing next
  function continuity(audioPath) {
    if (!audioPath) {
      audioPath = getLoop();
    }
    let nextPath = audioPath;
    if (getLoopHold()) {
      loopState.current += 1;
      gapless.forEach((player) => {
        player.singleMode = loopState.forever || getLoopHold();
        player.loop = player.singleMode;
      });
      updateSequenceIndicator();
    } else if (!loopState.forever) {
      nextPath = gapless.current().getTracks()[gapless.current().findTrack(audioPath) + 1];
      if (nextPath === undefined) {
        // re-shuffle at end of playlist
        resetTracks(true);
        return;
      }
      resetLoopState();
    }
    playLoop(nextPath, false);
    gapless.onStartedTrack(getLoopsRemaining());
  }

  function playLoop(audioPath, playAudio = true) {
    looper.pause();

    // if idle, do something
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    let paused = false;
    if (audioPath !== getLoop() || looper.src === '') {
      // switching to a new track
      if (playAudio) {
        resetLoopState();
        gapless.gotoTrack(audioPath);
        looper.playbackRate = gapless.getPlaybackRate(gapless.current());
        gapless.forEach((player) => { 
          player.play();
         });
        gapless.onStartedTrack(getLoopsRemaining());
      }
    } else if (!gapless.current().isPlaying()) {
      // unpausing
      if (playAudio) {
        gapless.forEach((player) => { player.play() });
      }
      looper.play();
    } else if (looperTransportButton("play-pause").attr("mode") === "play") {
      // repeating track
      looper.load();
      looper.play();
    } else {
      // pausing
      paused = true;
      if (playAudio) {
        gapless.forEach((player) => { player.pause() });
      }
      looper.pause();
    }

    if (paused) {
      $("#loop-visualizer").fadeOut(200);
    } else {
      $("#loop-visualizer").fadeIn(200);
    }
    looperTransportButton("play-pause").attr("mode", paused ? "play" : "pause");
    updateTransportButtons();
  }

  function updateTransportButtons() {
    const audioPath = getLoop();
    const canPlay = audioPath in loadedAudio;
    enableTransportButton("play-pause", canPlay);
    enableTransportButton("download", canPlay);
    enableTransportButton("hold-mode", true); // hold mode can be changed regardless of state

    if (audioPath) {
      const [id, tempo, _name] = toFilename(audioPath).split('.')[0].split('_');
      $("#loop-name").text(id);
      $("#loop-tempo").text(`${tempo} BPM`);
    }

    if (!canPlay) {
      enableTransportButton("shuffle-loops", false);
      enableTransportButton("prev-loop", false);
      enableTransportButton("next-loop", false);
    } else if (gapless.current().getIndex() >= 0) {
      // don't allow shuffle if a track is playing or paused
      enableTransportButton("shuffle-loops", !gapless.current().isPlaying());

      // disable prev/next based on if playing first or last track
      enableTransportButton("prev-loop", gapless.current().isPlaying() && getPrev() in loadedAudio);
      enableTransportButton("next-loop", gapless.current().isPlaying() && getNext() in loadedAudio);
    }
  }

  function resetTracks(forcePlay = false) {
    looper.pause();
    looper.removeAttribute('src');
    resetCurrentLoopProgress();
    gapless.forEach(player => {
      player.stop;
      player.removeAllTracks();
    });
    for (const audioPath in loadedAudio) {
      URL.revokeObjectURL(loadedAudio[audioPath]);
      delete loadedAudio[audioPath];
    }
    updateTransportButtons();
    playOnLoad = forcePlay;
    buildLoops();
  }

  function setHoldMode(modeIndex) {
    [holdMin, holdMax] = HOLD_MODES[modeIndex];
    if (holdMin === 0 || holdMax === 0) {
      loopState.forever = true;
    } else {
      loopState.forever = false;
      loopState.min = holdMin;
      loopState.max = holdMax;
    }
    resetLoopState();
    updateTransportButtons();
  }

  function downloadContent(content, type, filename) {
    const link = document.createElement("a");
    const file = new File([ content ], filename, { type });
    const blobURL = URL.createObjectURL(file);
    link.href = blobURL;
    link.setAttribute("download", filename);
    link.click();
  };

  // arm all buttons which belong into looper-transport
  function armLooperTransport() {
    const setupButton = (target, onClick) => {
      const button = looperTransportButton(target);
      button.animate({ backgroundSize: '75%' }, 0);
      button.off().on("click", function() {
        if (!$(this).hasClass("disabled")) {
          $(this).animate({ backgroundSize: '50%' }, 50, 'linear', function() {
            $(this).animate({ backgroundSize: '75%' }, 50, 'linear'); }
          );
          onClick($(this));
        }
      });
    };

    setupButton("shuffle-loops", () => resetTracks(false));

    setupButton("hold-mode", (selector) => {
      const prevIndex = parseInt(selector.attr("mode"));
      const nextIndex = prevIndex === HOLD_MODES.length - 1 ? 0 : prevIndex + 1;
      selector.attr("mode", nextIndex);
      setHoldMode(nextIndex);
    });

    setupButton("play-pause", () => {
      if (gapless.current().getIndex() === -1) {
        playLoop(gapless.current().getTracks()[0]);
      } else {
        playLoop(getLoop());
      }
    });

    setupButton("prev-loop", () => playLoop(getPrev()));

    setupButton("next-loop", () => playLoop(getNext()));

    setupButton("download", () => {
      const audioPath = getLoop();
      fetch(loadedAudio[audioPath]).then(r => {
        r.blob().then(audioFile => {
          const zip = new JSZip();
          zip.file("license.txt", LICENSE_MESSAGE);
          zip.file(toFilename(audioPath), audioFile);
          zip.generateAsync({type:"blob"})
          .then(content => {
            downloadContent(content, 'application/zip', `${toFilename(audioPath)}.zip`);
          });
        })
      });
    });

    // bottom panel toggling
    $('#credits-toggle').off().on("click", () => {
      $('#banner-filters').hide();
      $('#banner-credits').css('display', 'flex');
    });

    $('#close-toggle').off().on("click", () => {
      $('#banner-filters').css('display', 'block');
      $('#banner-credits').hide();
    });

    // bottom panel filtering
    Object.keys(PLAYLIST_FILTERS).forEach((filterMode) => {
      $(`.filter-button[target="${filterMode}"`).off().on("click", () => {
        if ($('#filter-selection').attr('mode') !== filterMode) {
          $('#filter-selection').attr('mode', filterMode);
          resetTracks();
        }
      });
    });
  }
});
