var pools = require('./pools');
var EasySAXParser = require('./easysax').EasySAXParser;
var parser = new EasySAXParser();

// Set to XHTML
parser.ns('xhtml');

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
    entry.attributes = pools.array.get();

    for (var key in attributes) {
      var attr = pools.object.get();
      attr.name = key;
      attr.value = attributes[key];
      entry.attributes.push(attr);
    }

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
  var selfClosing = {
    'area': true,
    'base': true,
    'br': true,
    'col': true,
    'command': true,
    'embed': true,
    'hr': true,
    'img': true,
    'input': true,
    'keygen': true,
    'link': true,
    'meta': true,
    'param': true,
    'source': true,
    'track': true,
    'wbr': true,
  };

  var parentOf = pools.object.get();

  parser.on('startNode', function(element, attrs) {
    var attributes = attrs();
  });

  parser.parse(newHTML);, {
    startElement: function(nodeName, attributes) {
      if (nodeName === '!DOCTYPE') {
        return;
      }

      var entry = makeEntry(nodeName, attributes);

      if (!documentElement) {
        documentElement = entry;
      }
      else {
        currentElement.childNodes.push(entry);
        parentOf[entry.element] = currentElement;
      }

      currentElement = entry;

      // Self closing elements.
      if (selfClosing[nodeName]) {
        currentElement = parentOf[currentElement.element];
      }
    },

    endElement: function(nodeName) {
      if (currentElement) {
        currentElement = parentOf[currentElement.element];
      }
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
