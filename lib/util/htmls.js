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
