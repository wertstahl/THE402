/*
 *
 * Gapless 5: Gapless JavaScript/CSS audio player for HTML5
 *
 * Version 0.8.1
 * Copyright 2014 Rego Sen
 *
*/

// PROBLEM: We have 2 APIs for playing audio through the web, and both of them have problems:
//  - HTML5 Audio: the last chunk of audio gets cut off, making gapless transitions impossible
//  - WebAudio: can't play a file until it's fully loaded
// SOLUTION: Use both!
// If WebAudio hasn't loaded yet, start playback with HTML5 Audio.  Then seamlessly switch to WebAudio once it's loaded.

window.hasWebKit = ('webkitAudioContext' in window) && !('chrome' in window);

const gapless5Players = {};
const Gapless5State = {
  None     : 0,
  Loading  : 1,
  Play     : 2,
  Stop     : 3,
  Error    : 4
};

// A Gapless5Source "class" handles track-specific audio requests
function Gapless5Source(parentPlayer, inContext, inOutputNode) {
  // WebAudio API
  const context = inContext;
  const outputNode = inOutputNode;

  // Audio object version
  let audio = null;

  // Buffer source version
  let source = null;
  let buffer = null;
  let request = null;

  // states
  let startTime = 0;
  let position = 0;
  let endpos = 0;
  let queuedState = Gapless5State.None;
  let state = Gapless5State.None;
  let loadedPercent = 0;
  let audioFinished = false; // eslint-disable-line no-unused-vars
  let endedCallback = null;

  // request manager info
  let initMS = new Date().getTime();

  this.uiDirty = false;
  const parent = parentPlayer;

  this.setGain = (val) => {
    if (audio !== null) {
      audio.volume = val;
    }
  };

  const setState = (newState) => {
    state = newState;
    queuedState = Gapless5State.None;
  };

  this.timer = () => {
    return (new Date().getTime()) - initMS;
  };

  this.cancelRequest = (isError) => {
    setState(isError ? Gapless5State.Error : Gapless5State.None);
    if (request) {
      request.abort();
    }
    audio = null;
    source = null;
    buffer = null;
    position = 0;
    endpos = 0;
    initMS = (new Date().getTime());
    this.uiDirty = true;
  };

  const onEnded = () => {
    if (state === Gapless5State.Play) {
      audioFinished = true;
      parent.onEndedCallback();
    }
  };

  const onPlayEvent = () => {
    startTime = (new Date().getTime()) - position;
  };

  const onError = () => {
    this.cancelRequest(true);
  };

  const onLoadedWebAudio = (inBuffer, audioPath) => {
    if (!request) {
      return;
    }
    request = null;
    buffer = inBuffer;
    endpos = inBuffer.duration * 1000;
    if (audio !== null || !parent.useHTML5Audio) {
      parent.dequeueNextLoad();
    }

    if (queuedState === Gapless5State.Play && state === Gapless5State.Loading) {
      playAudioFile(true);
    } else if ((audio !== null) && (queuedState === Gapless5State.None) && (state === Gapless5State.Play)) {
      // console.log("switching from HTML5 to WebAudio");
      position = new Date().getTime() - startTime;
      if (!window.hasWebKit) {
        position = position - this.tickMS;
      }
      this.setPosition(position, true);
    }
    if (state === Gapless5State.Loading) {
      state = Gapless5State.Stop;
    }

    parent.onload(audioPath);
    // once we have WebAudio data loaded, we don't need the HTML5 audio stream anymore
    audio = null;
    this.uiDirty = true;
  };

  const onLoadedHTML5Audio = () => {
    if (state !== Gapless5State.Loading) {
      return;
    }

    if (buffer !== null || !parent.useWebAudio) {
      parent.dequeueNextLoad();
    }

    state = Gapless5State.Stop;
    endpos = audio.duration * 1000;

    if (queuedState === Gapless5State.Play) {
      playAudioFile(true);
    }
    this.uiDirty = true;
  };

  this.stop = () => {
    if (state === Gapless5State.Stop) {
      return;
    }

    if (parent.useWebAudio) {
      if (source) {
        if (endedCallback) {
          window.clearTimeout(endedCallback);
          endedCallback = null;
        }
        source.stop(0);
      }
    }
    if (audio) {
      audio.pause();
    }

    setState(Gapless5State.Stop);
    this.uiDirty = true;
  };

  const playAudioFile = () => {
    if (state === Gapless5State.Play) {
      return;
    }
    position = Math.max(position, 0);
    if (!Number.isFinite(position) || position >= endpos) {
      position = 0;
    }

    const offsetSec = position / 1000;
    startTime = (new Date().getTime()) - position;

    if (buffer !== null) {
      // console.log("playing WebAudio");
      context.resume();
      source = context.createBufferSource();
      source.connect(outputNode);
      source.buffer = buffer;

      const restSec = source.buffer.duration - offsetSec;
      if (endedCallback) {
        window.clearTimeout(endedCallback);
      }
      endedCallback = window.setTimeout(onEnded, restSec * 1000);
      if (window.hasWebKit) {
        source.start(0, offsetSec, restSec);
      } else {
        source.start(0, offsetSec);
      }
      setState(Gapless5State.Play);
    } else if (audio !== null) {
      // console.log("playing HTML5 Audio");
      audio.currentTime = offsetSec;
      audio.volume = outputNode.gain.value;
      audio.play();
      setState(Gapless5State.Play);
    }
    this.uiDirty = true;
  };

  // PUBLIC FUNCTIONS

  this.inPlayState = () => {
    return (state === Gapless5State.Play);
  };

  this.isPlayActive = () => {
    return (this.inPlayState() || queuedState === Gapless5State.Play) && !this.audioFinished;
  };

  this.getPosition = () => {
    return position;
  };

  this.getLength = () => {
    return endpos;
  };

  this.play = () => {
    if (state === Gapless5State.Loading) {
      queuedState = Gapless5State.Play;
    } else {
      playAudioFile(); // play immediately
    }
  };

  this.tick = () => {
    if (state === Gapless5State.Play) {
      position = (new Date().getTime()) - startTime;
    }

    if (loadedPercent < 1) {
      let newPercent = 1;
      if (state === Gapless5State.Loading) {
        newPercent = 0;
      } else if (audio && audio.seekable.length > 0) {
        newPercent = (audio.seekable.end(0) / audio.duration);
      }
      if (loadedPercent !== newPercent) {
        loadedPercent = newPercent;
        parent.setLoadedSpan(loadedPercent);
      }
    }
  };

  this.setPosition = (newPosition, bResetPlay) => {
    position = newPosition;
    if (bResetPlay && this.inPlayState()) {
      this.stop();
      this.play();
    }
  };

  this.load = (inAudioPath) => {
    if (source || audio) {
      parent.dequeueNextLoad();
      return;
    }
    if (state === Gapless5State.Loading) {
      return;
    }
    state = Gapless5State.Loading;
    if (parent.useWebAudio) {
      const onLoadWebAudio = (data) => {
        if (data) {
          context.decodeAudioData(data,
            (incomingBuffer) => {
              onLoadedWebAudio(incomingBuffer, inAudioPath);
            }
          );
        }
      };
      if (inAudioPath.startsWith('blob:')) {
        fetch(inAudioPath).then((r) => {
          r.blob().then((blob) => {
            request = new FileReader();
            request.onload = () => {
              if (request) {
                onLoadWebAudio(request.result);
              }
            };
            request.readAsArrayBuffer(blob);
            if (request.error) {
              onError();
            }
          });
        });
      } else {
        request = new XMLHttpRequest();
        request.open('get', inAudioPath, true);
        request.responseType = 'arraybuffer';
        request.onload = () => {
          if (request) {
            onLoadWebAudio(request.response);
          }
        };
        request.onerror = () => {
          if (request) {
            onError();
          }
        };
        request.send();
      }
    }
    if (parent.useHTML5Audio) {
      const getHtml5Audio = () => {
        const audioObj = new Audio();
        audioObj.controls = false;
        audioObj.addEventListener('canplaythrough', onLoadedHTML5Audio, false);
        audioObj.addEventListener('ended', onEnded, false);
        audioObj.addEventListener('play', onPlayEvent, false);
        audioObj.addEventListener('error', onError, false);
        // TODO: switch to audio.networkState, now that it's universally supported
        return audioObj;
      };
      if (inAudioPath.startsWith('blob:')) {
        // TODO: blob as srcObject is not supported on all browsers
        fetch(inAudioPath).then((r) => {
          r.blob().then((blob) => {
            audio = getHtml5Audio();
            audio.srcObject = blob;
            audio.load();
          });
        });
      } else {
        audio = getHtml5Audio();
        audio.src = inAudioPath;
        audio.load();
      }
    }
  };
}

// A Gapless5FileList "class". Processes an array of JSON song objects, taking
// the "file" members out to constitute the this.sources[] in the Gapless5 player
function Gapless5FileList(inPlayList, inStartingTrack, inShuffle) {
  // OBJECT STATE
  // Playlist and Track Items
  this.original = inPlayList; // Starting JSON input
  this.previous = []; // Support double-toggle undo
  this.current = []; // Working playlist
  this.previousItem = 0; // To last list and last index

  if (inStartingTrack === 'random') {
    this.startingTrack = Math.floor(Math.random() * this.original.length);
  } else {
    this.startingTrack = inStartingTrack || 0;
  }

  this.currentItem = this.startingTrack;
  this.trackNumber = this.startingTrack; // Displayed track index in GUI

  // If the tracklist ordering changes, after a pre/next song,
  // the playlist needs to be regenerated
  this.shuffleMode = Boolean(inShuffle); // Ordered (false) or Shuffle (true)
  this.remakeList = false; // Will need to re-order list upon track changing

  // PRIVATE METHODS
  // Clone an object so it's not passed by reference
  // Works for objects that have no clever circular references
  // or complex types. It's a "flash serialize".
  const clone = (input) => {
    return JSON.parse(JSON.stringify(input));
  };

  // Swap two elements in an array
  const swapElements = (someList, sourceIndex, destIndex) => {
    const tmp = someList[sourceIndex];
    someList[sourceIndex] = someList[destIndex];
    someList[destIndex] = tmp;
  };

  // Reorder an array so that the outputList starts at the desiredIndex
  // of the inputList.
  const reorderedCopy = (inputList, desiredIndex) => {
    const tempList = clone(inputList);
    return tempList.concat(tempList.splice(0, desiredIndex));
  };

  // Shuffle a playlist, making sure that the next track in the list
  // won't be the same as the current track being played.
  const shuffledCopy = (inputList, index) => {
    let outputList = clone(inputList);

    // Shuffle the list
    for (let n = 0; n < outputList.length - 1; n++) {
      const k = n + Math.floor(Math.random() * (outputList.length - n));
      swapElements(outputList, k, n);
    }

    if (index !== -1) {
      // Reorder playlist array so that the chosen index comes first,
      // and gotoTrack isn't needed after Player object is remade.
      outputList = reorderedCopy(outputList, index);

      // After shuffling, move the current-playing track to the 0th
      // place in the index. So regardless of the next move, this track
      // will be appropriately far away in the list
      const swapIndex = this.lastIndex(index, this.current, outputList);
      if (swapIndex !== 0) {
        swapElements(outputList, swapIndex, 0);
      }
    }

    // If the list of indexes in the new list is the same as the last,
    // do a reshuffle. TOWRITE
    return outputList;
  };

  // Already pressed the shuffle button once from normal mode.
  // Revert to previous list / item, and terminate.
  const revertShuffle = () => {
    this.current = this.previous;
    this.currentItem = this.previousItem;

    this.shuffleMode = !this.shuffleMode;
    this.remakeList = false;
  };

  // Going into shuffle mode. Tell the Player to remake the list
  // as soon as a new track is reached or chosen.
  const enableShuffle = (preserveCurrent = true) => {
    // Save old state in case we need to revert
    this.previous = clone(this.current);
    this.previousItem = this.currentItem;

    this.current = shuffledCopy(this.original, preserveCurrent ? this.currentItem : -1);
    this.currentItem = 0;

    this.shuffleMode = true;
    this.remakeList = true;
  };

  // Leaving shuffle mode. Tell the Player to remake the list
  // as soon as a new track is reached or chosen.
  const disableShuffle = () => {
    // Save old state in case we need to revert
    this.previous = clone(this.current);
    this.previousItem = this.currentItem;

    // Find where current song is in original playlist, and make that
    // the head of the new unshuffled playlist
    const point = this.lastIndex(this.currentItem, this.current, this.original);
    this.current = reorderedCopy(this.original, point);

    this.currentItem = 0; // Position to head of list
    this.shuffleMode = false;
    this.remakeList = true;
  };

  // Add a song to a single member of the FileList object, adjusting
  // each FileList entry's index value as necessary.
  const addFile = (point, file, list, listShuffled) => {
    const addin = {};
    addin.index = point + 1;
    addin.file = file;

    // Prior to insertion, recalculate index on all shifted values.
    // All indexes that shifted up should be added by one.
    for (let i = 0; i < list.length; i++) {
      if (list[i].index >= addin.index) {
        list[i].index = list[i].index + 1;
      }
    }

    // If shuffle mode, new index should be array size so
    // unshuffled mode puts it at the back of the array.
    if (listShuffled) {
      list.push(addin);
    } else {
      list.splice(point, 0, addin);
    }
  };

  // Remove a song from a single member of the FileList object,
  // adjusting each FileList entry's index value as necessary.
  const removeFile = (point, list, listShuffled) => {
    if (listShuffled) {
      for (let j = 0; j < list.length; j++) {
        if (list[j].index === point + 1) {
          list.splice(j, 1);
        }
      }
    } else {
      list.splice(point, 1);
    }

    // After removing the item, re-number the indexes
    for (let k = 0; k < list.length; k++) {
      if (list[k].index >= point + 1) {
        list[k].index = list[k].index - 1;
      }
    }
  };


  // PUBLIC METHODS
  // After a shuffle or unshuffle, the array has changed. Get the index
  // for the current-displayed song in the previous array.
  this.lastIndex = (index, newList, oldList) => {
    const compare = newList[index];
    // Cannot compare full objects after clone() :(
    // Instead, compare the generated index
    for (let n = 0; n < oldList.length; n++) {
      if (oldList[n].index === compare.index) {
        return n;
      }
    }

    // Default value, in case some array value was removed
    return 0;
  };

  this.removeAllTracks = () => {
    this.original = [];
    this.previous = [];
    this.current = [];
    this.previousItem = 0;
    this.startingTrack = -1;
    this.currentItem = this.startingTrack;
    this.trackNumber = this.startingTrack;
  };

  // Toggle shuffle mode or not, and prepare for rebasing the playlist
  // upon changing to the next available song. NOTE that each function here
  // changes flags, so the logic must exclude any logic if a revert occurs.
  this.toggleShuffle = (forceReshuffle = false, preserveCurrent = true) => {
    if (forceReshuffle) {
      return enableShuffle(preserveCurrent);
    }
    if (this.remakeList) {
      return revertShuffle();
    }

    return this.shuffleMode ? disableShuffle() : enableShuffle(preserveCurrent);
  };

  // After toggling the list, the next/prev track action must trigger
  // the list getting remade, with the next desired track as the head.
  // This function will remake the list as needed.
  this.rebasePlayList = (index) => {
    if (this.shuffleMode) {
      this.current = reorderedCopy(this.current, index);
    }
    this.currentItem = 0; // Position to head of the list
    this.remakeList = false; // Rebasing is finished.
  };

  // Signify to this object that at the next track change, it will be OK
  // to reorder the current playlist starting at the next desired track.
  this.readyToRemake = () => {
    return this.remakeList;
  };

  // Are we in shuffle mode or not? If we just came out of shuffle mode,
  // the player object will want to know.
  this.isShuffled = () => {
    return this.shuffleMode;
  };

  // PlayList manipulation requires us to keep state on which track is
  // playing. Player object state changes may need to update the current
  // index in the FileList object as well.
  this.set = (index) => {
    this.previousItem = this.currentItem;
    this.currentItem = index;
    this.trackNumber = this.current[index].index;
  };

  // Get the "highlighted" track in the current playlist. After a shuffle,
  // this may not be the track that is currently playing.
  this.get = () => {
    return this.currentItem;
  };

  // Helper: find the given index in the current playlist
  this.getIndex = (index) => {
    if (this.isShuffled()) {
      for (let i = 0; i < this.current.length; i++) {
        if (this.current[i].index === index) {
          return i - 1;
        }
      }
    }
    return index;
  };

  // Add a new song into the FileList object.
  // TODO: this should take objects, not files, as input
  //   Consider rewriting deshuffle to rely entirely on index vals
  this.add = (index, file) => {
    const { current, original, remakeList, shuffleMode } = this;
    this.previous = clone(current);
    this.previousItem = this.currentItem;

    // Update current list
    addFile(index, file, current, shuffleMode);

    // Update original list. Assume it doesn't start in shuffle
    addFile(index, file, original, false);

    // Update the previous list too. If readyToRemake, that means
    // the last list is the opposite shuffleMode of the current.
    addFile(index, file, this.previous, remakeList ? !shuffleMode : shuffleMode);

    // Shift currentItem if the insert file is earlier in the list
    if (index <= this.currentItem || this.currentItem === -1) {
      this.currentItem = this.currentItem + 1;
    }
    this.trackNumber = current[this.currentItem].index;
  };

  // Remove a song from the FileList object.
  this.remove = (index) => {
    const { current, original, remakeList, shuffleMode } = this;
    this.previous = clone(current);
    this.previousItem = this.currentItem;

    // Remove from current array
    removeFile(index, current, shuffleMode);

    // Remove from the unshuffled array as well
    removeFile(index, original, shuffleMode);

    // Update previous list too
    removeFile(index, this.previous, remakeList ? !shuffleMode : shuffleMode);

    // Stay at the same song index, unless currentItem is after the
    // removed index, or was removed at the edge of the list
    if (this.currentItem > 0 &&
      ((index < this.currentItem) || (index >= this.previous.length - 1))) {
      this.currentItem = this.currentItem - 1;
    }

    this.trackNumber = current[this.currentItem].index;
  };

  // Get an array of songfile paths from this object, appropriate for
  // including in a Player object.
  this.files = () => {
    return this.current.map((song) => {
      return song.file;
    });
  };

  if (this.original.length > 0) {
    // Add index parameter to the JSON array of tracks
    for (let n = 0; n < this.original.length; n++) {
      this.original[n].index = n + 1;
    }

    // Set displayed song number to whatever the current-playing index is
    this.trackNumber = this.original[this.startingTrack].index;

    // Create the current playing list, based on startingTrack and shuffleMode.
    if (this.shuffleMode) {
      // If shuffle mode is on, shuffle the starting list
      this.current = clone(this.original);
      enableShuffle();
    } else {
      // On object creation, make current list use startingTrack as head of list
      this.current = reorderedCopy(this.original, this.startingTrack);
    }
  } else {
    this.current = [];
    this.currentItem = -1;
  }
}

// parameters are optional.
//   elementId: id of existing HTML element where UI should be rendered
//   initOptions:
//     tracks: path of file (or array of music file paths)
//     playOnLoad (default = false): play immediately
//     useWebAudio (default = true)
//     useHTML5Audio (default = true)
//     startingTrack (number or "random", default = 0)
//     shuffle (true or false): start the jukebox in shuffle mode
//     shuffleButton (default = true): whether shuffle button appears or not in UI
//     loop (default = false): whether to return to first track after end of playlist
//     singleMode (default = false): whether to treat single track as playlist
function Gapless5(elementId = '', initOptions = {}) { // eslint-disable-line no-unused-vars
// MEMBERS AND CONSTANTS

  // UI
  const tickMS = 27; // fast enough for numbers to look real-time
  const scrubSize = 65535;
  const statusText = {
    loading:  'loading\u2026',
    error: 'error!',
  };
  this.hasGUI = false;
  this.scrubWidth = 0;
  this.scrubPosition = 0;
  this.isScrubbing = false;

  // System
  this.initialized = false;

  this.loop = ('loop' in initOptions) && (initOptions.loop);
  this.singleMode = ('singleMode' in initOptions) && (initOptions.singleMode);

  this.useWebAudio = ('useWebAudio' in initOptions) ? initOptions.useWebAudio : true;
  this.useHTML5Audio = ('useHTML5Audio' in initOptions) ? initOptions.useHTML5Audio : true;
  this.id = Math.floor((1 + Math.random()) * 0x10000);


  // There can be only one AudioContext per window, so to have multiple players we must define this outside the player scope
  if (window.gapless5AudioContext === undefined) {
    if (window.hasWebKit) {
      // eslint-disable-next-line new-cap
      window.gapless5AudioContext = new webkitAudioContext();
    } else if (typeof AudioContext !== 'undefined') {
      window.gapless5AudioContext = new AudioContext();
    }
  }
  const context = window.gapless5AudioContext;
  const gainNode = (context !== undefined) ? context.createGain() : null;
  if (context && gainNode) {
    gainNode.connect(context.destination);
  }

  // Playlist
  this.trk = null; // Playlist manager object
  this.sources = []; // List of Gapless5Sources
  this.loadQueue = []; // List of files to consume
  this.loadingTrack = -1; // What file to consume

  // Callback and Execution logic
  this.isPlayButton = true;
  this.keyMappings = {};

  // Callbacks
  this.onprev = () => {};
  this.onplay = () => {};
  this.onpause = () => {};
  this.onstop = () => {};
  this.onnext = () => {};
  this.onshuffle = () => {};

  this.onerror = () => {};
  this.onload = () => {};
  this.onfinishedtrack = () => {};
  this.onfinishedall = () => {};


  // INTERNAL HELPERS
  const getUIPos = () => {
    const { isScrubbing, scrubPosition } = this;
    const position = isScrubbing ? scrubPosition : this.currentSource().getPosition();
    return (position / this.currentSource().getLength()) * scrubSize;
  };

  const getSoundPos = (uiPosition) => {
    return ((uiPosition / scrubSize) * this.currentSource().getLength());
  };

  const numTracks = () => {
  // FileList object must be initiated
    if (this.sources.length > 0 && this.trk !== null) {
      return this.trk.current.length;
    }
    return 0;
  };

  // Index for calculating actual playlist location
  const index = () => {
  // FileList object must be initiated
    if (this.trk !== null) {
      return this.trk.get();
    }
    return -1;
  };

  // Index for displaying the currently playing
  // track, suitable for use in update functions
  const dispIndex = () => {
    const maxIndex = this.sources.length - 1;
    if (readyToRemake()) {
      return Math.min(this.trk.previousItem, maxIndex);
    } else if (this.trk !== null) {
      return Math.min(this.trk.get(), maxIndex);
    }
    return -1;
  };

  const readyToRemake = () => {
  // FileList object must be initiated
    if (this.trk.readyToRemake() !== null) {
      return this.trk.readyToRemake();
    }
    return false;
  };

  const getFormattedTime = (inMS) => {
    let minutes = Math.floor(inMS / 60000);
    const secondsFull = (inMS - (minutes * 60000)) / 1000;
    let seconds = Math.floor(secondsFull);
    let csec = Math.floor((secondsFull - seconds) * 100);

    if (minutes < 10) {
      minutes = `0${minutes}`;
    }
    if (seconds < 10) {
      seconds = `0${seconds}`;
    }
    if (csec < 10) {
      csec = `0${csec}`;
    }

    return `${minutes}:${seconds}.${csec}`;
  };

  const getTotalPositionText = () => {
    let text = statusText.loading;
    if (this.sources.length === 0) {
      return text;
    }
    const source = this.currentSource();
    const srcLength = source.getLength();
    if (numTracks() === 0) {
      text = getFormattedTime(0);
    } else if (source.state === Gapless5State.Error) {
      text = statusText.error;
    } else if (srcLength > 0) {
      text = getFormattedTime(srcLength);
    }
    return text;
  };

  // after shuffle mode toggle and track change, re-grab the tracklist
  const refreshTracks = (newIndex) => {
  // prevent updates while tracks are coming in
    this.initialized = false;

    this.removeAllTracks(false);
    this.trk.rebasePlayList(newIndex);

    const tracks = this.getTracks();
    for (let i = 0; i < tracks.length; i++) {
      this.addInitialTrack(tracks[i]);
    }

    // re-enable GUI updates
    this.initialized = true;
  };

  const getElement = (prefix) => {
    return document.getElementById(`${prefix}${this.id}`);
  };

  // Determines how and when the next track should be loaded.
  this.dequeueNextLoad = () => {
    if (this.loadQueue.length > 0) {
      const entry = this.loadQueue.shift();
      this.loadingTrack = entry[0];
      if (this.loadingTrack < this.sources.length) {
        this.sources[this.loadingTrack].load(entry[1]);
      }
    } else {
      this.loadingTrack = -1;
    }
  };

  // (PUBLIC) ACTIONS
  this.totalTracks = () => {
    return numTracks();
  };

  this.mapKeys = (keyOptions) => {
    for (let key in keyOptions) {
      const uppercode = keyOptions[key].toUpperCase().charCodeAt(0);
      const lowercode = keyOptions[key].toLowerCase().charCodeAt(0);
      const player = gapless5Players[this.id];
      if (Gapless5.prototype.hasOwnProperty.call(player, key)) {
        this.keyMappings[uppercode] = player[key];
        this.keyMappings[lowercode] = player[key];
      } else {
        console.error(`Gapless5 mapKeys() error: no function named '${key}'`);
      }
    }
    document.addEventListener('keydown', (e) => {
      const keyCode = e.key.charCodeAt(0);
      if (keyCode in this.keyMappings) {
        this.keyMappings[keyCode](e);
      }
    });
  };

  this.setGain = (uiPos) => {
    const normalized = uiPos / scrubSize;
    gainNode.gain.value = normalized;
    this.currentSource().setGain(normalized);
  };

  this.scrub = (uiPos, updateTransport = false) => {
    this.scrubPosition = getSoundPos(uiPos);
    if (this.hasGUI) {
      getElement('currentPosition').innerText = getFormattedTime(this.scrubPosition);
      enableButton('prev', this.loop || (index() !== 0 || this.scrubPosition !== 0));
      if (updateTransport) {
        getElement('transportbar').value = uiPos;
      }
    }
    if (!this.isScrubbing) {
      this.currentSource().setPosition(this.scrubPosition, true);
    }
  };

  this.setLoadedSpan = (percent) => {
    if (this.hasGUI) {
      getElement('loaded-span').style.width = percent * this.scrubWidth;
      if (percent === 1) {
        getElement('totalPosition').innerText = getTotalPositionText();
      }
    }
  };

  this.onEndedCallback = () => {
  // we've finished playing the track
    resetPosition();
    this.currentSource().stop(true);
    if (this.loop || index() < numTracks() - 1) {
      if (this.singleMode) {
        this.prev(true);
      } else {
        this.next(true);
      }
      this.onfinishedtrack();
    } else {
      this.onfinishedtrack();
      this.onfinishedall();
    }
  };

  this.onStartedScrubbing = () => {
    this.isScrubbing = true;
  };

  this.onFinishedScrubbing = () => {
    this.isScrubbing = false;
    if (this.currentSource().inPlayState() && this.scrubPosition >= this.currentSource().getLength()) {
      this.next(true);
    } else {
      this.currentSource().setPosition(this.scrubPosition, true);
    }
  };

  // Assume the FileList already accounts for this track, and just add it to the
  // loading queue. Until this.sources[] lives in the FileList object, this compromise
  // ensures addTrack/removeTrack functions can modify the FileList object when
  // called by Gapless applications.
  this.addInitialTrack = (audioPath) => {
    const next = this.sources.length;
    this.sources[next] = new Gapless5Source(this, context, gainNode);
    this.loadQueue.push([ next, audioPath ]);
    if (this.loadingTrack === -1) {
      this.dequeueNextLoad();
    }
    if (this.initialized) {
      updateDisplay();
    }
  };

  this.addTrack = (audioPath) => {
    const next = this.sources.length;
    this.sources[next] = new Gapless5Source(this, context, gainNode);
    // TODO: refactor to take an entire JSON object
    // TODO: move this function to the fileList object
    this.trk.add(next, audioPath);
    this.loadQueue.push([ next, audioPath ]);
    if (this.loadingTrack === -1) {
      this.dequeueNextLoad();
    }
    if (this.initialized) {
      updateDisplay();
    }
  };

  this.insertTrack = (point, audioPath) => {
    const trackCount = numTracks();
    const safePoint = Math.min(Math.max(point, 0), trackCount);
    if (safePoint === trackCount) {
      this.addTrack(audioPath);
    } else {
      this.sources.splice(safePoint, 0, new Gapless5Source(this, context, gainNode));
      // TODO: refactor to take an entire JSON object
      // TODO: move this function to the fileList object
      this.trk.add(safePoint, audioPath);
      // re-enumerate queue
      for (let i in this.loadQueue) {
        const entry = this.loadQueue[i];
        if (entry[0] >= safePoint) {
          entry[0] = entry[0] + 1;
        }
      }
      this.loadQueue.splice(0, 0, [ safePoint, audioPath ]);
      updateDisplay();
    }
  };

  this.getTracks = () => {
    return this.trk.files();
  };

  this.findTrack = (path) => {
    return this.getTracks().indexOf(path);
  };

  this.removeTrack = (pointOrPath) => {
    const point = (typeof pointOrPath === 'string') ?
      this.findTrack(pointOrPath) :
      pointOrPath;

    if (point < 0 || point >= this.sources.length) {
      return;
    }
    const deletedPlaying = point === this.trk.currentItem;

    const curSource = this.sources[point];
    if (!curSource) {
      return;
    }
    let wasPlaying = false;

    if (curSource.state === Gapless5State.Loading) {
      curSource.cancelRequest();
    } else if (curSource.state === Gapless5State.Play) {
      wasPlaying = true;
      curSource.stop();
    }

    let removeIndex = -1;
    for (let i in this.loadQueue) {
      const entry = this.loadQueue[i];
      if (entry[0] === point) {
        removeIndex = i;
        break;
      } else if (entry[0] > point) {
        entry[0] = entry[0] - 1;
      }
    }
    if (removeIndex >= 0) {
      this.loadQueue.splice(removeIndex, 1);
    }
    // TODO: move this functionality into the FileList object
    this.sources.splice(point, 1);
    this.trk.remove(point);

    if (this.loadingTrack === point) {
      this.dequeueNextLoad();
    }
    if (deletedPlaying) {
      this.next(); // Don't stop after a delete
      if (wasPlaying) {
        this.play();
      }
    }

    if (this.initialized) {
      updateDisplay();
    }
  };

  this.replaceTrack = (point, audioPath) => {
    this.removeTrack(point);
    this.insertTrack(point, audioPath);
  };

  this.removeAllTracks = (flushPlaylist = true) => {
    for (let i = 0; i < this.sources.length; i++) {
      if (this.sources[i].state === Gapless5State.Loading) {
        this.sources[i].cancelRequest();
      }
      this.sources[i].stop();
    }
    if (flushPlaylist) {
      this.trk.removeAllTracks();
    }
    this.loadingTrack = -1;
    // TODO: move this function into the FileList object
    this.sources = [];
    this.loadQueue = [];
    if (this.initialized) {
      updateDisplay();
    }
  };

  this.isShuffled = () => {
    return this.trk.isShuffled();
  };

  // shuffles, re-shuffling if previously shuffled
  this.shuffle = (preserveCurrent = true) => {
    if (!canShuffle()) {
      return;
    }

    this.trk.toggleShuffle(true, preserveCurrent);

    if (this.initialized) {
      updateDisplay();
    }
  };

  // toggles between shuffled and unshuffled
  this.toggleShuffle = () => {
    if (!canShuffle()) {
      return;
    }

    this.trk.toggleShuffle();

    if (this.initialized) {
      updateDisplay();
    }
  };
  // backwards-compatibility with previous function name
  this.shuffleToggle = this.toggleShuffle;

  this.currentSource = () => this.sources[dispIndex()];

  this.gotoTrack = (pointOrPath, bForcePlay) => {
    const newIndex = (typeof pointOrPath === 'string') ?
      this.findTrack(pointOrPath) :
      pointOrPath;

    let justRemade = false;

    // If the list is flagged for remaking on the change of shuffle mode,
    // remake the list in shuffled order
    if (readyToRemake()) {
    // just changed our shuffle mode. remake the list
      refreshTracks(newIndex);
      justRemade = true;
    }

    // No shuffle / unshuffle occurred, and we're just restarting a track
    if (!justRemade && newIndex === index()) {
      resetPosition();
      if ((bForcePlay) || this.sources[index()].isPlayActive()) {
        this.sources[newIndex].play();
      }
    } else if (justRemade) {
      // A shuffle or an unshuffle just occurred
      this.trk.set(newIndex);
      this.sources[newIndex].load(this.getTracks()[newIndex]);
      this.sources[newIndex].play();

      updateDisplay();
    } else {
    // A normal track change just occurred
      const oldIndex = index();
      this.trk.set(newIndex);
      // Cancel any track that's in loading state right now
      if (this.sources[oldIndex].state === Gapless5State.Loading) {
        this.sources[oldIndex].cancelRequest();
        // TODO: better way to have just the file list?
        this.loadQueue.push([ oldIndex, this.getTracks()[oldIndex] ]);
      }

      resetPosition(true); // make sure this comes after currentIndex has been updated
      if (this.sources[newIndex].state === Gapless5State.None) {
      // TODO: better way to have just the file list?
        this.sources[newIndex].load(this.getTracks()[newIndex]);

        // re-sort queue so that this track is at the head of the list
        for (let i in this.loadQueue) { // eslint-disable-line no-unused-vars
          const entry = this.loadQueue.shift();
          if (entry[0] === newIndex) {
            break;
          }
          this.loadQueue.push(entry);
        }
      }
      updateDisplay();

      if ((bForcePlay) || this.sources[oldIndex].isPlayActive()) {
        this.sources[newIndex].play();
      }
      this.sources[oldIndex].stop(); // call this last
    }
    enableButton('prev', this.loop || (!this.singleMode && newIndex > 0));
    enableButton('next', this.loop || (!this.singleMode && newIndex < numTracks() - 1));
  };

  this.prevtrack = () => {
    if (this.sources.length === 0) {
      return;
    }
    let track = 0;
    if (index() > 0) {
      track = index() - 1;
    } else if (this.loop) {
      track = numTracks() - 1;
    } else {
      return;
    }
    this.gotoTrack(track);
    this.onprev();
  };

  this.prev = (e) => {
    if (this.sources.length === 0) {
      return;
    }
    let wantsCallback = true;
    let track = 0;
    if (readyToRemake()) {
    // jump to start of track that's in a new position
    // at the head of the re-made list.
      wantsCallback = false;
    } else if (this.sources[index()].getPosition() > 0) {
    // jump to start of track if we're not there
      track = index();
      wantsCallback = false;
    } else if (this.singleMode && this.loop) {
      track = index();
    } else if (index() > 0) {
      track = index() - 1;
    } else if (this.loop) {
      track = numTracks() - 1;
    } else {
      return;
    }
    this.gotoTrack(track, e === true);
    if (wantsCallback) {
      this.onprev();
    }
  };

  this.next = (e) => {
    if (this.sources.length === 0) {
      return;
    }
    let track = 0;
    if (this.singleMode) {
      track = index();
    } else if (index() < numTracks() - 1) {
      track = index() + 1;
    } else if (!this.loop) {
      return;
    }
    this.gotoTrack(track, e === true);
    this.onnext();
  };

  this.play = () => {
    if (this.sources.length === 0) {
      return;
    }
    if (this.currentSource().audioFinished) {
      this.next(true);
    } else {
      this.currentSource().play();
    }
    this.onplay();
  };

  this.playpause = (e) => {
    if (this.isPlayButton) {
      this.play(e);
    } else {
      this.pause(e);
    }
  };

  this.cue = (e) => {
    if (!this.isPlayButton) {
      this.prev(e);
    } else if (this.currentSource().getPosition() > 0) {
      this.prev(e);
      this.play(e);
    } else {
      this.play(e);
    }
  };

  this.pause = () => {
    if (this.sources.length === 0) {
      return;
    }
    this.currentSource().stop();
    this.onpause();
  };

  this.stop = () => {
    if (this.sources.length === 0) {
      return;
    }
    resetPosition();
    this.currentSource().stop(true);
    this.onstop();
  };


  // (PUBLIC) QUERIES AND CALLBACKS

  this.isPlaying = () => {
    return this.currentSource().inPlayState();
  };

  // INIT AND UI

  const resetPosition = (forceScrub) => {
    if (forceScrub || this.currentSource().getPosition() > 0) {
      this.scrub(0, true);
    }
  };

  const enableButton = (buttonId, bEnable) => {
    if (this.hasGUI) {
      const buttonClasses = getElement(buttonId).classList;
      buttonClasses.remove(bEnable ? 'disabled' : 'enabled');
      buttonClasses.add(bEnable ? 'enabled' : 'disabled');
    }
  };

  const enableShuffleButton = (mode, bEnable) => {
    const elem = getElement('shuffle');
    if (elem) {
      const isShuffle = mode === 'shuffle';
      elem.classList.remove(isShuffle ? 'g5unshuffle' : 'g5shuffle');
      elem.classList.add(isShuffle ? 'g5shuffle' : 'g5unshuffle');
      enableButton('shuffle', bEnable);
    }
  };

  // Must have at least 3 tracks in order for shuffle button to work
  // If so, permanently turn on the shuffle toggle
  const canShuffle = () => {
    return this.trk.current.length > 2;
  };

  const updateDisplay = () => {
    const { trk, loop, hasGUI } = this;
    if (!hasGUI) {
      return;
    }
    if (numTracks() === 0) {
      getElement('trackIndex').innerText = '0';
      getElement('tracks').innerText = '0';
      getElement('totalPosition').innerText = '00:00.00';
      enableButton('prev', false);
      enableShuffleButton('shuffle', false);
      enableButton('next', false);
    } else {
      getElement('trackIndex').innerText = trk.trackNumber;
      getElement('tracks').innerText = trk.current.length;
      getElement('totalPosition').innerText = getTotalPositionText();
      enableButton('prev', loop || index() > 0 || this.sources[index()].getPosition() > 0);
      enableButton('next', loop || index() < numTracks() - 1);

      if (this.currentSource().inPlayState()) {
        enableButton('play', false);
        this.isPlayButton = false;
      } else {
        enableButton('play', true);
        this.isPlayButton = true;

        if (this.currentSource().state === Gapless5State.Error) {
          this.onerror();
        }
      }

      enableShuffleButton(this.trk.isShuffled() ? 'unshuffle' : 'shuffle', canShuffle());
      this.sources[index()].uiDirty = false;
    }
  };

  const tick = () => {
    if (numTracks() > 0) {
      this.currentSource().tick();

      if (this.currentSource().uiDirty) {
        updateDisplay();
      }
      if (this.currentSource().inPlayState()) {
        let soundPos = this.currentSource().getPosition();
        if (this.isScrubbing) {
        // playing track, update bar position
          soundPos = this.scrubPosition;
        }
        if (this.hasGUI) {
          getElement('transportbar').value = getUIPos();
          getElement('currentPosition').innerText = getFormattedTime(soundPos);
        }
      }
    }
    window.setTimeout(() => {
      tick();
    }, tickMS);
  };

  const createGUI = (playerHandle) => {
    const { id } = this;
    const playerWrapper = (html) => {
      return `
    <div class="g5position" id="g5position${id}">
      <span id="currentPosition${id}">00:00.00</span> |
      <span id="totalPosition${id}">${statusText.loading}</span> |
      <span id="trackIndex${id}">1</span>/<span id="tracks${id}">1</span>
    </div>
    <div class="g5inside" id="g5inside${id}">
      ${html}
    </div>
  `;
    };

    if (typeof Audio === 'undefined') {
      return playerWrapper('This player is not supported by your browser.');
    }

    return playerWrapper(`
    <div class="g5transport">
      <div class="g5meter" id="g5meter${id}"><span id="loaded-span${id}" style="width: 0%"></span></div>
        <input type="range" class="transportbar" name="transportbar" id="transportbar${id}"
        min="0" max="${scrubSize}" value="0" oninput="${playerHandle}.scrub(this.value);"
        onmousedown="${playerHandle}.onStartedScrubbing();" ontouchstart="${playerHandle}.onStartedScrubbing();"
        onmouseup="${playerHandle}.onFinishedScrubbing();" ontouchend="${playerHandle}.onFinishedScrubbing();" />
      </div>
    <div class="g5buttons" id="g5buttons${id}">
      <button class="g5button g5prev" id="prev${id}"></button>
      <button class="g5button g5play" id="play${id}"></button>
      <button class="g5button g5stop" id="stop${id}"></button>
      <button class="g5button g5shuffle" id="shuffle${id}"></button>
      <button class="g5button g5next" id="next${id}"></button>
      <input type="range" class="volume" name="gain" min="0" max="${scrubSize}"
        value="${scrubSize}" oninput="${playerHandle}.setGain(this.value);"
      />
    </div>
  `);
  };

  const init = (guiId, options) => {
    const guiElement = guiId ? document.getElementById(guiId) : null;
    const { id } = this;
    gapless5Players[id] = this;

    if (guiElement) {
      this.hasGUI = true;
      guiElement.insertAdjacentHTML('beforeend', createGUI(`gapless5Players[${id}]`));

      // css adjustments
      if (navigator.userAgent.indexOf('macOS') === -1) {
        getElement('transportbar').classList.add('g5meter-1pxup');
      }

      const onMouseDown = (elemId, cb) => {
        const elem = getElement(elemId);
        if (elem) {
          elem.addEventListener('mousedown', cb);
        }
      };

      // set up button mappings
      onMouseDown('prev', gapless5Players[id].prev);
      onMouseDown('play', gapless5Players[id].playpause);
      onMouseDown('stop', gapless5Players[id].stop);
      onMouseDown('shuffle', gapless5Players[id].toggleShuffle);
      onMouseDown('next', gapless5Players[id].next);

      enableButton('play', true);
      enableButton('stop', true);

      // set up whether shuffleButton appears or not (default is visible)
      if (('shuffleButton' in options) && !options.shuffleButton) {
      // Style items per earlier Gapless versions
        const transSize = '111px';
        const playSize = '115px';
        getElement('transportbar').style.width = transSize;
        getElement('g5meter').style.width = transSize;
        getElement('g5position').style.width = playSize;
        getElement('g5inside').style.width = playSize;
        getElement('shuffle').remove();
      }
      this.scrubWidth = getElement('transportbar').style.width;
    }

    if (typeof Audio === 'undefined') {
      console.error('This player is not supported by your browser.');
      return;
    }

    // set up starting track number
    if ('startingTrack' in options) {
      if (typeof options.startingTrack === 'number') {
        this.startingTrack = options.startingTrack;
      } else if ((typeof options.startingTrack === 'string') && (options.startingTrack === 'random')) {
        this.startingTrack = 'random';
      }
    }

    // set up key mappings
    if ('mapKeys' in options) {
      this.mapKeys(options.mapKeys);
    }

    // set up whether shuffle is enabled when the player loads (default is false)
    const shuffleOnInit = ('shuffle' in options) && options.shuffle;

    // set up tracks into a FileList object
    if ('tracks' in options) {
      const setupTracks = (player) => {
        const tracks = player.getTracks();
        for (let i = 0; i < tracks.length; i++) {
          player.addInitialTrack(tracks[i]);
        }
      };

      let items = [];
      let startingTrack = 0;
      if (Array.isArray(options.tracks)) {
        if (typeof options.tracks[0] === 'string') {
        // convert array into JSON items
          for (let i = 0; i < options.tracks.length; i++) {
            items[i] = { file: options.tracks[i] };
          }
        } else if (typeof options.tracks[0] === 'object') {
          items = options.tracks;
          startingTrack = this.startingTrack || 0;
        }
      } else if (typeof options.tracks === 'string') {
        items[0] = { file: options.tracks };
      }
      this.trk = new Gapless5FileList(items, startingTrack, shuffleOnInit);
      setupTracks(this);
    } else {
      this.trk = new Gapless5FileList([], -1, shuffleOnInit);
    }

    this.initialized = true;
    updateDisplay();

    // autostart if desired
    const playOnLoad = ('playOnLoad' in options) && options.playOnLoad;
    if (playOnLoad && (this.trk.current.length > 0)) {
      this.sources[index()].play();
    }
    tick();
  };

  init(elementId, initOptions);
}

// simple UMD plumbing based on https://gist.github.com/kamleshchandnani/07c63f3d728672d91f97b69bbf700eed
(function umd(global, factory) {
  if (typeof define === 'function' && define.amd) {
    define([ 'exports' ], factory);
  } else if (typeof exports !== 'undefined') {
    factory(exports);
  } else {
    const mod = {
      exports: {}
    };
    factory(mod.exports);
    global.Gapless5 = mod.exports.Gapless5;
  }
}(this, (exports) => {
  exports.Gapless5 = Gapless5;
}));
