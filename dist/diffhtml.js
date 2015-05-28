(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.diffhtml = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var makeNode = require('./make_node');

function makeElement(descriptor) {
  var element = null;

  if (descriptor.nodeName === '#text') {
    element = document.createTextNode(descriptor.nodeValue);
  }
  else {
    element = document.createElement(descriptor.nodeName);

    if (descriptor.attributes && descriptor.attributes.length) {
      for (var i = 0; i < descriptor.attributes.length; i++) {
        var attribute = descriptor.attributes[i];
        // FIXME valid attribute names
        if (attribute.name !== '/') {
          element.setAttribute(attribute.name, attribute.value);
        }
      }
    }

    if (descriptor.childNodes && descriptor.childNodes.length) {
      for (var i = 0; i < descriptor.childNodes.length; i++) {
        element.appendChild(makeElement(descriptor.childNodes[i]));
      }
    }
  }

  // Add to the nodes cache using the designated id.
  makeNode.nodes[descriptor.element] = element;

  return element;
}

module.exports = makeElement;

},{"./make_node":2}],2:[function(require,module,exports){
var pools = require('../util/pools');
var push = Array.prototype.push;

var nodes = makeNode.nodes = {};

/**
 * Converts a live node into a virtual node.
 *
 * @param node
 * @return
 */
function makeNode(node) {
  // If this node has already been converted, do not attempt to convert again.
  if (node && node.__node__) {
    return node.__node__;
  }

  var nodeType = node.nodeType;
  var nodeValue = node.nodeValue;

  if (!nodeType || nodeType === 2 || nodeType === 4 || nodeType === 8) {
    return false;
  }

  if (nodeType === 3 && !nodeValue.trim()) {
    return false;
  }

  // Virtual representation of a node, containing only the data we wish to
  // diff and patch.
  var entry = {};

  // Cache the element in the ids.
  var id = pools.uuid.get();

  // Add to internal lookup.
  nodes[id] = node;

  // Save a reference to this object.
  node.__node__ = entry;

  entry.element = id;
  entry.nodeName = node.nodeName.toLowerCase();
  entry.nodeValue = nodeValue;
  entry.childNodes = [];
  entry.attributes = [];

  // Collect attributes.
  var attributes = node.attributes;

  // If the element has no attributes, skip over.
  if (attributes) {
    var attributesLength = attributes.length;

    if (attributesLength) {
      for (var i = 0; i < attributesLength; i++) {
        push.call(entry.attributes, {
          name: attributes[i].name,
          value: attributes[i].value
        });
      }
    }
  }

  // Collect childNodes.
  var childNodes = node.childNodes;
  var childNodesLength = node.childNodes.length;
  var newNode = null;

  // If the element has child nodes, convert them all to virtual nodes.
  if (node.nodeType !== 3 && childNodes) {
    for (var i = 0; i < childNodesLength; i++) {
      newNode = makeNode(childNodes[i]);

      if (newNode) {
        entry.childNodes.push(newNode);
      }
    }
  }

  return entry;
}

module.exports = makeNode;

},{"../util/pools":8}],3:[function(require,module,exports){
var pools = require('../util/pools');
var htmls = require('../util/htmls');
var simplehtml = require('../util/simplehtml');
var buffers = require('../util/buffers');
var syncNode = require('./sync_node');
var makeNode = require('./make_node');
var makeElement = require('./make_element');

// Initialize with a reasonable amount of objects.
pools.initialize(1000);

// Set a cleanup array.
syncNode.sync.cleanup = pools.array.get();

var hasWorker = typeof Worker === 'function';
var oldTree = null;
var isRendering = false;
var synced = false;

// Set up a WebWorker if available.
if (hasWorker) {
  // Construct the worker reusing code already organized into modules.
  var workerBlob = new Blob([
    [
      // Reusable Array methods.
      'var slice = Array.prototype.slice;',
      'var filter = Array.prototype.filter;',

      // Add a namespace to attach pool methods to.
      'var pools = {};',
      'var nodes = 0;',

      // Adds in a global `uuid` function.
      require('../util/uuid'),

      // Add in pool manipulation methods.
      pools.create,
      pools.initialize,

      // Add in Node manipulation.
      syncNode.filter,
      syncNode.sync,

      // Add in the ability to parseHTML.
      htmls.makeEntry,
      htmls.parseHTML,

      // Give the webworker utilities.
      buffers.stringToBuffer,
      buffers.bufferToString,

      simplehtml.parser,
      'var parser = makeParser();',

      // Add in the worker source.
      require('../worker'),

      // Metaprogramming up this worker call.
      'startup(self);'
    ].join('\n')
  ], { type: 'application/javascript' });

  // Construct the worker and start it up.
  var worker = new Worker(URL.createObjectURL(workerBlob));
}

function getElement(ref) {
  var element = ref.element || ref;

  // Already created.
  if (element in makeNode.nodes) {
    return makeNode.nodes[element];
  }
  // Need to create.
  else {
    return makeElement(ref);
  }
}

/**
 * Processes an Array of patches.
 *
 * @param e
 * @return
 */
function processPatches(e) {
  var patches = e.data;

  // Loop through all the patches and apply them.
  for (var i = 0; i < patches.length; i++) {
    var patch = patches[i];

    if (patch.element) {
      patch.element = getElement(patch.element);
      var elementId = patch.element;
    }

    if (patch.old) {
      patch.old = getElement(patch.old);
      var oldId = patch.old.element;
    }

    if (patch.new) {
      patch.new = getElement(patch.new);
      var newId = patch.new.element;
    }

    // Quickly empty entire childNodes.
    if (patch.__do__ === -1) {
      patch.element.innerHTML = '';
      continue;
    }

    // Node manip.
    else if (patch.__do__ === 1) {
      // Add.
      if (patch.element && patch.fragment && !patch.old) {
        var fragment = document.createDocumentFragment();

        patch.fragment.forEach(function(element) {
          fragment.appendChild(getElement(element));
        });

        patch.element.appendChild(fragment);
      }

      // Remove
      else if (patch.old && !patch.new) {
        if (!patch.old.parentNode) {
          throw new Error('Can\'t remove without parent, is this the ' +
            'document root?');
        }

        patch.old.parentNode.removeChild(patch.old);
        makeNode.nodes[oldId] = null;
        delete makeNode.nodes[oldId];
      }

      // Replace
      else if (patch.old && patch.new) {
        if (!patch.old.parentNode) {
          throw new Error('Can\'t replace without parent, is this the ' +
            'document root?');
        }

        patch.old.parentNode.replaceChild(patch.new, patch.old);

        makeNode.nodes[oldId] = null;
        delete makeNode.nodes[oldId];
      }
    }

    // Attribute manipulation.
    else if (patch.__do__ === 2) {
      // Remove.
      if (!patch.value) { patch.element.removeAttribute(patch.name); }
      else { patch.element.setAttribute(patch.name, patch.value); }
    }

    // Text node manipulation.
    else if (patch.__do__ === 3) {
      patch.element.nodeValue = patch.value;
    }
  }
}

/**
 * Patches an element's DOM to match that of the passed markup.
 *
 * @param element
 * @param newHTML
 */
function patch(element, newHTML) {
  if (isRendering) { return; }

  // Attach all properties here to transport.
  var transferObject = {};

  // Only calculate the parent's initial state one time.
  if (!oldTree) {
    oldTree = makeNode(element);
    transferObject.oldTree = oldTree;
    element.__source__ = newHTML;
  }
  // Same markup being applied, early exit.
  else if (element.__source__ === newHTML) {
    return;
  }

  // Optionally disable workers.
  hasWorker = !Boolean(document.DISABLE_WORKER);

  // Will want to ensure that the first render went through, the worker can
  // take a bit to startup and we want to show changes as soon as possible.
  if (hasWorker && element.__has_rendered__) {
    // First time syncing needs the current tree.
    if (!synced) {
      transferObject.oldTree = oldTree;
    }

    synced = true;

    var start = Date.now();

    // Used to specify the outerHTML offset if passing the parent's markup.
    var offset = 0;

    // Craft a new buffer with the new contents.
    var newBuffer = buffers.stringToBuffer(newHTML);

    // Set the offset to be this byte length.
    offset = newBuffer.byteLength;

    // Calculate the bytelength for the transfer buffer, contains one extra for
    // the offset.
    var transferByteLength = newBuffer.byteLength;

    // This buffer starts with the offset and contains the data to be carried
    // to the worker.
    var transferBuffer = new Uint16Array(transferByteLength);

    // Set the newHTML payload.
    transferBuffer.set(newBuffer, 0);

    // Add properties to send to worker.
    transferObject.offset = newBuffer.byteLength;
    transferObject.buffer = transferBuffer.buffer;

    // Set a render lock as to not flood the worker.
    isRendering = true;

    // Transfer this buffer to the worker, which will take over and process the
    // markup.
    worker.postMessage(transferObject, [transferBuffer.buffer]);

    // Wait for the worker to finish processing and then apply the patchset.
    worker.onmessage = function(e) {
      processPatches(e);
      isRendering = false;
    };
  }
  else if (!hasWorker || !element.__has_rendered__) {
    var newTree = htmls.parseHTML(newHTML);
    var patches = pools.array.get();

    // Synchronize the tree.
    syncNode.sync.call(patches, oldTree, newTree);

    // Process the patches immediately.
    processPatches({ data: patches });

    // Cleanup sync node allocations.
    syncNode.sync.cleanup.forEach(pools.array.free);
    syncNode.sync.cleanup.length = 0;

    // Clean out this array.
    pools.array.free(patches);

    // Mark this element as initially rendered.
    if (!element.__has_rendered__) {
      element.__has_rendered__ = true;
    }
  }
}

module.exports = patch;

},{"../util/buffers":6,"../util/htmls":7,"../util/pools":8,"../util/simplehtml":9,"../util/uuid":10,"../worker":11,"./make_element":1,"./make_node":2,"./sync_node":4}],4:[function(require,module,exports){
var pools = require('../util/pools');
var slice = Array.prototype.slice;
var filter = Array.prototype.filter;

/**
 * syncNode
 *
 * @param virtualNode
 * @param liveNode
 * @return
 */
function syncNode(virtualNode, liveNode) {
  var patches = this;

  // For now always sync the children.  In the future we'll be smarter about
  // when this is necessary.
  var oldChildNodes = virtualNode.childNodes;
  var oldChildNodesLength = oldChildNodes ? oldChildNodes.length : 0;
  var nodeValue = liveNode.nodeValue;

  // Filter down the childNodes to only what we care about.
  var childNodes = liveNode.childNodes;
  var newChildNodesLength = childNodes ? childNodes.length : 0;

  // Replace text node values if they are different.
  if (liveNode.nodeName === '#text' && virtualNode.nodeName === '#text') {
    // Text changed.
    if (virtualNode.nodeValue !== liveNode.nodeValue) {
      virtualNode.nodeValue = liveNode.nodeValue;

      patches.push({
        __do__: 3,
        element: virtualNode.element,
        value: nodeValue
      });
    }

    return;
  }

  if (newChildNodesLength) {
    // Most common additive elements.
    if (newChildNodesLength > oldChildNodesLength) {
      // Store elements in a DocumentFragment to increase performance and be
      // generally simplier to work with.
      var fragment = pools.array.get();

      // Add to cleanup queue.
      syncNode.cleanup.push(fragment);

      for (var i = oldChildNodesLength; i < newChildNodesLength; i++) {
        // Internally add to the tree.
        virtualNode.childNodes.push(childNodes[i]);

        // Add to the document fragment.
        fragment.push(childNodes[i]);
      }

      // Assign the fragment to the patches to be injected.
      patches.push({
        __do__: 1,
        element: virtualNode.element,
        fragment: fragment
      });
    }

    // Remove these elements.
    if (oldChildNodesLength > newChildNodesLength) {
      // Elements to remove.
      var toRemove = slice.call(virtualNode.childNodes, -1 * (oldChildNodesLength - newChildNodesLength));

      for (var i = 0; i < toRemove.length; i++) {
        // Remove the element, this happens before the splice so that we still
        // have access to the element.
        patches.push({ __do__: 1, old: toRemove[i].element });

        // Free allocated objects.
        pools.array.free(toRemove[i].childNodes);
        pools.uuid.free(toRemove[i].element);
      }

      virtualNode.childNodes.splice(newChildNodesLength, oldChildNodesLength - newChildNodesLength);
    }

    // Replace elements if they are different.
    for (var i = 0; i < newChildNodesLength; i++) {
      if (virtualNode.childNodes[i].nodeName !== childNodes[i].nodeName) {
        // Add to the patches.
        patches.push({
          __do__: 1,
          old: virtualNode.childNodes[i],
          new: childNodes[i]
        });

        // Free allocated objects.
        pools.array.free(virtualNode.childNodes[i].childNodes);
        pools.uuid.free(virtualNode.childNodes[i].element);

        // Replace the internal tree's point of view of this element.
        virtualNode.childNodes[i] = childNodes[i];
      }
    }
  }
  // Remove all children if the new live node has none.
  else if (oldChildNodesLength && !newChildNodesLength) {
    patches.push({ __do__: -1, element: virtualNode.element });
    virtualNode.childNodes.splice(0, oldChildNodesLength);
  }

  // Synchronize attributes
  var attributes = liveNode.attributes;

  if (attributes) {
    var oldLength = virtualNode.attributes.length;
    var newLength = attributes.length;

    // Start with the most common, additive.
    if (newLength > oldLength) {
      var toAdd = slice.call(attributes, oldLength - 1);

      for (var i = 0; i < toAdd.length; i++) {
        var change = {
          __do__: 2,
          element: virtualNode.element,
          name: toAdd[i].name,
          value: toAdd[i].value,
        };

        // Push the change object into into the virtual tree.
        var index = virtualNode.attributes.push(toAdd[i]);

        // Add the change to the series of patches.
        patches.push(change);
      }
    }

    // Check for removals.
    if (oldLength > newLength) {
      var toRemove = slice.call(virtualNode.attributes, newLength);

      for (var i = 0; i < toRemove.length; i++) {
        var change = {
          __do__: 2,
          element: virtualNode.element,
          name: toRemove[i].name,
          value: undefined,
        };

        // Remove the attribute from the virtual node.
        virtualNode.attributes.splice(i, 1);

        // Add the change to the series of patches.
        patches.push(change);
      }
    }

    // Check for modifications.
    var toModify = slice.call(attributes);

    for (var i = 0; i < toModify.length; i++) {
      var change = {
        __do__: 2,
        element: virtualNode.element,
        name: toModify[i].name,
        value: toModify[i].value,
      };

      var oldAttrValue = virtualNode.attributes[i] && virtualNode.attributes[i].value;
      var newAttrValue = attributes[i] && attributes[i].value;

      // Only push in a change if the attribute or value changes.
      if (oldAttrValue !== newAttrValue) {
        // Replace the attribute in the virtual node.
        virtualNode.attributes.splice(i, 1, toModify[i]);

        // Add the change to the series of patches.
        patches.push(change);
      }
    }
  }

  // Sync each current node.
  for (var i = 0; i < virtualNode.childNodes.length; i++) {
    if (virtualNode.childNodes[i] !== childNodes[i]) {
      syncNode.call(patches, virtualNode.childNodes[i], childNodes[i]);
    }
  }
}

exports.sync = syncNode;

},{"../util/pools":8}],5:[function(require,module,exports){
var patchNode = require('./diff/patch_node');

Object.defineProperty(Element.prototype, 'outerDiffHTML', {
  configurable: true,

  set: function(newHTML) {
    patchNode(this, newHTML);
  }
});

},{"./diff/patch_node":3}],6:[function(require,module,exports){
/**
 * stringToBuffer
 *
 * @param string
 * @return
 */
exports.stringToBuffer = function stringToBuffer(string) {
  var buffer = new Uint16Array(string.length);

  for (var i = 0; i < string.length; i++) {
    buffer[i] = string.codePointAt(i);
  }

  return buffer;
};

/**
 * bufferToString
 *
 * @param buffer
 * @return
 */
exports.bufferToString = function bufferToString(buffer) {
  var tmpBuffer = new Uint16Array(buffer, 0, buffer.length);
  var string = '';

  for (var i = 0; i < tmpBuffer.length; i++) {
    string += String.fromCodePoint(tmpBuffer[i]);
  }

  return string;
};

},{}],7:[function(require,module,exports){
var pools = require('./pools');
var parser = require('./simplehtml').parser();

/**
 * makeEntry
 *
 * @param nodeName
 * @param attributes
 * @return
 */
function makeEntry(nodeName, attributes) {
  var entry = pools.object.get();

  entry.nodeName = nodeName;
  entry.element = pools.uuid.get();

  if (nodeName === '#text') {
    entry.nodeValue = attributes;
  }
  else {
    entry.attributes = attributes;
    entry.childNodes = pools.array.get();
  }

  return entry;
}

/**
 * parseHTML
 *
 * @param newHTML
 * @return
 */
function parseHTML(newHTML) {
  var documentElement = null;
  var currentElement = null;

  // Not exhaustive.
  var selfClosing = [
    'area',
    'base',
    'br',
    'col',
    'command',
    'embed',
    'hr',
    'img',
    'input',
    'keygen',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr'
  ];

  var parentOf = pools.object.get();

  parser.parse(newHTML, {
    startElement: function(nodeName, attributes) {
      if (nodeName === '!DOCTYPE') {
        return;
      }

      var entry = makeEntry(nodeName, attributes);

      // Initial array.
      parentOf[entry.element] = pools.array.get();

      if (!documentElement) {
        documentElement = entry;
      }
      else {
        currentElement.childNodes.push(entry);
        parentOf[entry.element] = currentElement;
      }

      currentElement = entry;

      // Self closing elements.
      if (selfClosing.indexOf(nodeName) > -1) {
        currentElement = parentOf[currentElement.element];
      }
    },

    endElement: function(nodeName) {
      currentElement = parentOf[currentElement.element];
    },

    characters: function(string) {
      if (string.trim()) {
        currentElement.childNodes.push(makeEntry('#text', string));
      }
    }
  });

  return documentElement;
}

exports.makeEntry = makeEntry;
exports.parseHTML = parseHTML;

},{"./pools":8,"./simplehtml":9}],8:[function(require,module,exports){
var pools = exports;
var uuid = require('./uuid');

function createPool(size, fill) {
  var free = [];
  var allocated = [];

  // Prime the cache with n objects.
  for (var i = 0; i < size; i++) {
    free[i] = fill();
  }

  return {
    get: function() {
      var obj = null;

      if (free.length) {
        obj = free.pop();
      }
      else {
        obj = fill();
      }

      allocated.push(obj);
      return obj;
    },

    free: function(obj) {
      var idx = allocated.indexOf(obj);

      // Clean.
      if (Array.isArray(obj)) {
        obj.length = 0;
      }
      else {
        for (var key in obj) {
          if (obj.hasOwnProperty(key)) {
            delete obj[key];
          }
        }
      }

      free.push(obj);
      allocated.splice(idx, 1);
    }
  };
}


function initializePools(COUNT) {
  pools.object = createPool(COUNT, function() {
    return {};
  });

  pools.array = createPool(COUNT, function() {
    return [];
  });

  pools.uuid = createPool(COUNT, function() {
    return uuid();
  });
}

exports.create = createPool;
exports.initialize = initializePools;

},{"./uuid":10}],9:[function(require,module,exports){
// Original code by Erik Arvidsson, Mozilla Public License
// http://erik.eae.net/simplehtmlparser/simplehtmlparser.js
var pools = require('./pools');

function makeParser() {
  function SimpleHTMLParser() {}

  SimpleHTMLParser.prototype = {
    handler:  null,

    // regexps
    startTagRe: /^<([^>\s\/]+)((\s+[^=>\s]+(\s*=\s*((\"[^"]*\")|(\'[^']*\')|[^>\s]+))?)*)\s*\/?\s*>/m,
    endTagRe: /^<\/([^>\s]+)[^>]*>/m,
    attrRe:   /([^=\s]+)(\s*=\s*((\"([^"]*)\")|(\'([^']*)\')|[^>\s]+))?/gm,

    parse: function (s, oHandler) {
      if (oHandler) {
        this.contentHandler = oHandler;
      }

      var i = 0;
      var res, lc, lm, rc, index;
      var treatAsChars = false;
      var oThis = this;

      while (s.length > 0) {
        // Comment
        if (s.substring(0, 4) == "<!--") {
          index = s.indexOf("-->");
          if (index != -1) {
            this.contentHandler.comment(s.substring(4, index));
            s = s.substring(index + 3);
            treatAsChars = false;
          }
          else {
            treatAsChars = true;
          }
        }

        // end tag
        else if (s.substring(0, 2) == "</") {
          if (this.endTagRe.test(s)) {
            lc = RegExp.leftContext;
            lm = RegExp.lastMatch;
            rc = RegExp.rightContext;

            lm.replace(this.endTagRe, function() {
              return oThis.parseEndTag.apply(oThis, arguments);
            });

            s = rc;
            treatAsChars = false;
          }
          else {
            treatAsChars = true;
          }
        }
        // start tag
        else if (s.charAt(0) == "<") {
          if (this.startTagRe.test(s)) {
            lc = RegExp.leftContext;
            lm = RegExp.lastMatch;
            rc = RegExp.rightContext;

            lm.replace(this.startTagRe, function() {
              return oThis.parseStartTag.apply(oThis, arguments);
            });

            s = rc;
            treatAsChars = false;
          }
          else {
            treatAsChars = true;
          }
        }

        if (treatAsChars) {
          index = s.indexOf("<");
          if (index == -1) {
             this.contentHandler.characters(s);
            s = "";
          }
          else {
            this.contentHandler.characters(s.substring(0, index));
            s = s.substring(index);
          }
        }

        treatAsChars = true;
      }
    },

    parseStartTag:  function (sTag, sTagName, sRest) {
      var attrs = this.parseAttributes(sTagName, sRest);
      this.contentHandler.startElement(sTagName, attrs);
    },

    parseEndTag:  function (sTag, sTagName) {
      this.contentHandler.endElement(sTagName);
    },

    parseAttributes:  function (sTagName, s) {
      var oThis = this;
      var attrs = [];
      s.replace(this.attrRe, function (a0, a1, a2, a3, a4, a5, a6)
      {
        attrs.push(oThis.parseAttribute(sTagName, a0, a1, a2, a3, a4, a5, a6));
      });
      return attrs;
    },

    parseAttribute: function (sTagName, sAttribute, sName) {
      var value = "";
      if (arguments[7])
        value = arguments[8];
      else if (arguments[5])
        value = arguments[6];
      else if (arguments[3])
        value = arguments[4];

      var empty = !value && !arguments[3];
      var obj = pools.object.get();
      obj.name = sName;
      obj.value = empty ? null : value;
      return obj;
    }
  }

  return new SimpleHTMLParser();
}

exports.parser = makeParser;

},{"./pools":8}],10:[function(require,module,exports){
/**
 * Generates a uuid.
 *
 * @see http://stackoverflow.com/a/2117523/282175
 * @return {string} uuid
 */
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8);
    return v.toString(16);
  });
}

module.exports = uuid;

},{}],11:[function(require,module,exports){
function startup(worker) {
  // Initialize the pool with a reasonable amount of objects.
  initializePools(1000);
  syncNode.cleanup = pools.array.get();

  var oldTree = null;
  var patches = [];

  worker.onmessage = function(e) {
    var data = e.data;
    var offset = data.offset;
    var transferBuffer = data.buffer;

    var newBuffer = transferBuffer.slice(0, offset);
    var newHTML = bufferToString(newBuffer);

    if (offset && !oldTree) {
      // Keep a virtual tree in memory to diff against.
      oldTree = e.data.oldTree;
    }

    // Calculate a new tree.
    var newTree = parseHTML(newHTML);

    // Synchronize the old virtual tree with the new virtual tree.  This will
    // produce a series of patches that will be excuted to update the DOM.
    syncNode.call(patches, oldTree, newTree);

    // Send the patches back to the userland.
    worker.postMessage(patches);

    // Cleanup sync node allocations.
    syncNode.cleanup.forEach(pools.array.free);
    syncNode.cleanup.length = 0;

    // Wipe out the patches in memory.
    patches.length = 0;
  };
}

module.exports = startup;

},{}]},{},[5])(5)
});