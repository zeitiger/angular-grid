(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
// Angular Grid
// Written by Niall Crosby
// www.angulargrid.com


(function() {

    // Establish the root object, `window` or `exports`
    var root = this;
    var Grid = require('./grid');

    // if angular is present, register the directive
    if (typeof angular !== 'undefined') {
        var angularModule = angular.module("angularGrid", []);
        angularModule.directive("angularGrid", function() {
            return {
                restrict: "A",
                controller: ['$element', '$scope', '$compile', AngularDirectiveController],
                scope: {
                    angularGrid: "="
                }
            };
        });
    }

    if (typeof exports !== 'undefined') {
        if (typeof module !== 'undefined' && module.exports) {
            exports = module.exports = angularGridGlobalFunction;
        }
        exports.angularGrid = angularGridGlobalFunction;
    } else {
        root.angularGrid = angularGridGlobalFunction;
    }


    function AngularDirectiveController($element, $scope, $compile) {
        var eGridDiv = $element[0];
        var gridOptions = $scope.angularGrid;
        if (!gridOptions) {
            console.warn("WARNING - grid options for Angular Grid not found. Please ensure the attribute angular-grid points to a valid object on the scope");
            return;
        }
        var grid = new Grid(eGridDiv, gridOptions, $scope, $compile);

        $scope.$on("$destroy", function() {
            grid.setFinished();
        });
    }

    // Global Function - this function is used for creating a grid, outside of any AngularJS
    function angularGridGlobalFunction(element, gridOptions) {
        // see if element is a query selector, or a real element
        var eGridDiv;
        if (typeof element === 'string') {
            eGridDiv = document.querySelector(element);
            if (!eGridDiv) {
                console.log('WARNING - was not able to find element ' + element + ' in the DOM, Angular Grid initialisation aborted.');
                return;
            }
        } else {
            eGridDiv = element;
        }
        new Grid(eGridDiv, gridOptions, null, null);
    }

}).call(this);

},{"./grid":12}],2:[function(require,module,exports){
var constants = require('./constants');

function ColumnController() {
    this.createModel();
}

ColumnController.prototype.init = function(angularGrid, selectionRendererFactory, gridOptionsWrapper) {
    this.gridOptionsWrapper = gridOptionsWrapper;
    this.angularGrid = angularGrid;
    this.selectionRendererFactory = selectionRendererFactory;
};

ColumnController.prototype.createModel = function() {
    var that = this;
    this.model = {
        // used by:
        // + inMemoryRowController -> sorting, building quick filter text
        // + headerRenderer -> sorting (clearing icon)
        getAllColumns: function() {
            return that.columns;
        },
        // + rowController -> while inserting rows, and when tabbing through cells (need to change this)
        // need a newMethod - get next col index
        getVisibleColumns: function() {
            return that.visibleColumns;
        },
        // used by:
        // + angularGrid -> for setting body width
        // + rowController -> setting main row widths (when inserting and resizing)
        getBodyContainerWidth: function() {
            return that.getTotalColWidth(false);
        },
        // used by:
        // + angularGrid -> setting pinned body width
        getPinnedContainerWidth: function() {
            return that.getTotalColWidth(true);
        },
        // used by:
        // + headerRenderer -> setting pinned body width
        getColumnGroups: function() {
            return that.columnGroups;
        }
    };
};

ColumnController.prototype.getModel = function() {
    return this.model;
};

// called by angularGrid
ColumnController.prototype.setColumns = function(columnDefs) {
    this.buildColumns(columnDefs);
    this.ensureEachColHasSize();
    this.buildGroups();
    this.updateGroups();
    this.updateVisibleColumns();
};

// called by headerRenderer - when a header is opened or closed
ColumnController.prototype.columnGroupOpened = function(group) {
    group.expanded = !group.expanded;
    this.updateGroups();
    this.updateVisibleColumns();
    this.angularGrid.refreshHeaderAndBody();
};

// private
ColumnController.prototype.updateVisibleColumns = function() {
    // if not grouping by headers, then all columns are visible
    if (!this.gridOptionsWrapper.isGroupHeaders()) {
        this.visibleColumns = this.columns;
        return;
    }

    // if grouping, then only show col as per group rules
    this.visibleColumns = [];
    for (var i = 0; i < this.columnGroups.length; i++) {
        var group = this.columnGroups[i];
        group.addToVisibleColumns(this.visibleColumns);
    }
};

// public - called from api
ColumnController.prototype.sizeColumnsToFit = function(availableWidth) {
    // avoid divide by zero
    if (availableWidth <= 0 || this.visibleColumns.length === 0) {
        return;
    }

    var currentTotalWidth = this.getTotalColWidth();
    var scale = availableWidth / currentTotalWidth;

    // size all cols except the last by the scale
    for (var i = 0; i < (this.visibleColumns.length - 1); i++) {
        var column = this.visibleColumns[i];
        var newWidth = parseInt(column.actualWidth * scale);
        column.actualWidth = newWidth;
    }

    // size the last by whats remaining (this avoids rounding errors that could
    // occur with scaling everything, where it result in some pixels off)
    var pixelsLeftForLastCol = availableWidth - this.getTotalColWidth();
    var lastColumn = this.visibleColumns[this.visibleColumns.length - 1];
    lastColumn.actualWidth += pixelsLeftForLastCol;

    // widths set, refresh the gui
    this.angularGrid.refreshHeaderAndBody();
};

// private
ColumnController.prototype.buildGroups = function() {
    // if not grouping by headers, do nothing
    if (!this.gridOptionsWrapper.isGroupHeaders()) {
        this.columnGroups = null;
        return;
    }

    // split the columns into groups
    var currentGroup = null;
    this.columnGroups = [];
    var that = this;

    var lastColWasPinned = true;

    this.columns.forEach(function(column) {
        // do we need a new group, because we move from pinned to non-pinned columns?
        var endOfPinnedHeader = lastColWasPinned && !column.pinned;
        if (!column.pinned) {
            lastColWasPinned = false;
        }
        // do we need a new group, because the group names doesn't match from previous col?
        var groupKeyMismatch = currentGroup && column.colDef.group !== currentGroup.name;
        // we don't group columns where no group is specified
        var colNotInGroup = currentGroup && !currentGroup.name;
        // do we need a new group, because we are just starting
        var processingFirstCol = column.index === 0;
        var newGroupNeeded = processingFirstCol || endOfPinnedHeader || groupKeyMismatch || colNotInGroup;
        // create new group, if it's needed
        if (newGroupNeeded) {
            var pinned = column.pinned;
            currentGroup = new ColumnGroup(pinned, column.colDef.group);
            that.columnGroups.push(currentGroup);
        }
        currentGroup.addColumn(column);
    });
};

// private
ColumnController.prototype.updateGroups = function() {
    // if not grouping by headers, do nothing
    if (!this.gridOptionsWrapper.isGroupHeaders()) {
        return;
    }

    for (var i = 0; i < this.columnGroups.length; i++) {
        var group = this.columnGroups[i];
        group.calculateExpandable();
        group.calculateVisibleColumns();
    }
};

// private
ColumnController.prototype.buildColumns = function(columnDefs) {
    this.columns = [];
    var that = this;
    var pinnedColumnCount = this.gridOptionsWrapper.getPinnedColCount();
    if (columnDefs) {
        for (var i = 0; i < columnDefs.length; i++) {
            var colDef = columnDefs[i];
            // this is messy - we swap in another col def if it's checkbox selection - not happy :(
            if (colDef === 'checkboxSelection') {
                colDef = that.selectionRendererFactory.createCheckboxColDef();
            }
            var pinned = pinnedColumnCount > i;
            var column = new Column(colDef, i, pinned);
            that.columns.push(column);
        }
    }
};

// private
// set the actual widths for each col
ColumnController.prototype.ensureEachColHasSize = function() {
    this.columns.forEach(function(colDefWrapper) {
        var colDef = colDefWrapper.colDef;
        if (colDefWrapper.actualWidth) {
            // if actual width already set, do nothing
            return;
        } else if (!colDef.width) {
            // if no width defined in colDef, default to 200
            colDefWrapper.actualWidth = 200;
        } else if (colDef.width < constants.MIN_COL_WIDTH) {
            // if width in col def to small, set to min width
            colDefWrapper.actualWidth = constants.MIN_COL_WIDTH;
        } else {
            // otherwise use the provided width
            colDefWrapper.actualWidth = colDef.width;
        }
    });
};

// private
// call with true (pinned), false (not-pinned) or undefined (all columns)
ColumnController.prototype.getTotalColWidth = function(includePinned) {
    var widthSoFar = 0;
    var pinedNotImportant = typeof includePinned !== 'boolean';

    this.visibleColumns.forEach(function(column) {
        var includeThisCol = pinedNotImportant || column.pinned === includePinned;
        if (includeThisCol) {
            widthSoFar += column.actualWidth;
        }
    });

    return widthSoFar;
};

function ColumnGroup(pinned, name) {
    this.pinned = pinned;
    this.name = name;
    this.allColumns = [];
    this.visibleColumns = [];
    this.expandable = false; // whether this group can be expanded or not
    this.expanded = false;
}

ColumnGroup.prototype.addColumn = function(column) {
    this.allColumns.push(column);
};

// need to check that this group has at least one col showing when both expanded and contracted.
// if not, then we don't allow expanding and contracting on this group
ColumnGroup.prototype.calculateExpandable = function() {
    // want to make sure the group doesn't disappear when it's open
    var atLeastOneShowingWhenOpen = false;
    // want to make sure the group doesn't disappear when it's closed
    var atLeastOneShowingWhenClosed = false;
    // want to make sure the group has something to show / hide
    var atLeastOneChangeable = false;
    for (var i = 0, j = this.allColumns.length; i < j; i++) {
        var column = this.allColumns[i];
        if (column.colDef.groupShow === 'open') {
            atLeastOneShowingWhenOpen = true;
            atLeastOneChangeable = true;
        } else if (column.colDef.groupShow === 'closed') {
            atLeastOneShowingWhenClosed = true;
            atLeastOneChangeable = true;
        } else {
            atLeastOneShowingWhenOpen = true;
            atLeastOneShowingWhenClosed = true;
        }
    }

    this.expandable = atLeastOneShowingWhenOpen && atLeastOneShowingWhenClosed && atLeastOneChangeable;
};

ColumnGroup.prototype.calculateVisibleColumns = function() {
    // clear out last time we calculated
    this.visibleColumns = [];
    // it not expandable, everything is visible
    if (!this.expandable) {
        this.visibleColumns = this.allColumns;
        return;
    }
    // and calculate again
    for (var i = 0, j = this.allColumns.length; i < j; i++) {
        var column = this.allColumns[i];
        switch (column.colDef.groupShow) {
            case 'open':
                // when set to open, only show col if group is open
                if (this.expanded) {
                    this.visibleColumns.push(column);
                }
                break;
            case 'closed':
                // when set to open, only show col if group is open
                if (!this.expanded) {
                    this.visibleColumns.push(column);
                }
                break;
            default:
                // default is always show the column
                this.visibleColumns.push(column);
                break;
        }
    }
};

ColumnGroup.prototype.addToVisibleColumns = function(allVisibleColumns) {
    for (var i = 0; i < this.visibleColumns.length; i++) {
        var column = this.visibleColumns[i];
        allVisibleColumns.push(column);
    }
};

function Column(colDef, index, pinned) {
    this.colDef = colDef;
    this.index = index;
    this.pinned = pinned;
    // in the future, the colKey might be something other than the index
    this.colKey = index;
}

module.exports = ColumnController;

},{"./constants":3}],3:[function(require,module,exports){
var constants = {
    STEP_EVERYTHING: 0,
    STEP_FILTER: 1,
    STEP_SORT: 2,
    STEP_MAP: 3,
    ASC: "asc",
    DESC: "desc",
    ROW_BUFFER_SIZE: 5,
    SORT_STYLE_SHOW: "display:inline;",
    SORT_STYLE_HIDE: "display:none;",
    MIN_COL_WIDTH: 10,
};

module.exports = constants;

},{}],4:[function(require,module,exports){
var utils = require('./../utils');
var SetFilter = require('./setFilter');
var NumberFilter = require('./numberFilter');
var StringFilter = require('./textFilter');

function FilterManager() {}

FilterManager.prototype.init = function(grid, gridOptionsWrapper, $compile, $scope) {
    this.$compile = $compile;
    this.$scope = $scope;
    this.gridOptionsWrapper = gridOptionsWrapper;
    this.grid = grid;
    this.allFilters = {};
};

FilterManager.prototype.setRowModel = function(rowModel) {
    this.rowModel = rowModel;
};

// returns true if at least one filter is active
FilterManager.prototype.isFilterPresent = function() {
    var atLeastOneActive = false;
    var that = this;

    var keys = Object.keys(this.allFilters);
    keys.forEach(function(key) {
        var filterWrapper = that.allFilters[key];
        if (!filterWrapper.filter.isFilterActive) { // because users can do custom filters, give nice error message
            console.error('Filter is missing method isFilterActive');
        }
        if (filterWrapper.filter.isFilterActive()) {
            atLeastOneActive = true;
        }
    });
    return atLeastOneActive;
};

// returns true if given col has a filter active
FilterManager.prototype.isFilterPresentForCol = function(colKey) {
    var filterWrapper = this.allFilters[colKey];
    if (!filterWrapper) {
        return false;
    }
    if (!filterWrapper.filter.isFilterActive) { // because users can do custom filters, give nice error message
        console.error('Filter is missing method isFilterActive');
    }
    var filterPresent = filterWrapper.filter.isFilterActive();
    return filterPresent;
};

FilterManager.prototype.doesFilterPass = function(node) {
    var data = node.data;
    var colKeys = Object.keys(this.allFilters);
    for (var i = 0, l = colKeys.length; i < l; i++) { // critical code, don't use functional programming

        var colKey = colKeys[i];
        var filterWrapper = this.allFilters[colKey];

        // if no filter, always pass
        if (filterWrapper === undefined) {
            continue;
        }

        var value = data[filterWrapper.field];
        if (!filterWrapper.filter.doesFilterPass) { // because users can do custom filters, give nice error message
            console.error('Filter is missing method doesFilterPass');
        }
        var model;
        // if model is exposed, grab it
        if (filterWrapper.filter.getModel) {
            model = filterWrapper.filter.getModel();
        }
        var params = {
            value: value,
            model: model,
            node: node,
            data: data
        };
        if (!filterWrapper.filter.doesFilterPass(params)) {
            return false;
        }
    }
    // all filters passed
    return true;
};

FilterManager.prototype.onNewRowsLoaded = function() {
    var that = this;
    Object.keys(this.allFilters).forEach(function(field) {
        var filter = that.allFilters[field].filter;
        if (filter.onNewRowsLoaded) {
            filter.onNewRowsLoaded();
        }
    });
};

FilterManager.prototype.positionPopup = function(eventSource, ePopup, ePopupRoot) {
    var sourceRect = eventSource.getBoundingClientRect();
    var parentRect = ePopupRoot.getBoundingClientRect();

    var x = sourceRect.left - parentRect.left;
    var y = sourceRect.top - parentRect.top + sourceRect.height;

    // if popup is overflowing to the right, move it left
    var widthOfPopup = 200; // this is set in the css
    var widthOfParent = parentRect.right - parentRect.left;
    var maxX = widthOfParent - widthOfPopup - 20; // 20 pixels grace
    if (x > maxX) { // move position left, back into view
        x = maxX;
    }
    if (x < 0) { // in case the popup has a negative value
        x = 0;
    }

    ePopup.style.left = x + "px";
    ePopup.style.top = y + "px";
};

FilterManager.prototype.showFilter = function(colDefWrapper, eventSource) {

    var filterWrapper = this.allFilters[colDefWrapper.colKey];
    var colDef = colDefWrapper.colDef;

    if (!filterWrapper) {
        filterWrapper = {
            colKey: colDefWrapper.colKey,
            field: colDef.field
        };
        var filterChangedCallback = this.grid.onFilterChanged.bind(this.grid);
        var filterParams = colDef.filterParams;
        var params = {
            colDef: colDef,
            rowModel: this.rowModel,
            filterChangedCallback: filterChangedCallback,
            filterParams: filterParams,
            scope: filterWrapper.scope
        };
        if (typeof colDef.filter === 'function') {
            // if user provided a filter, just use it
            // first up, create child scope if needed
            if (this.gridOptionsWrapper.isAngularCompileFilters()) {
                var scope = this.$scope.$new();
                filterWrapper.scope = scope;
                params.$scope = scope;
            }
            // now create filter
            filterWrapper.filter = new colDef.filter(params);
        } else if (colDef.filter === 'text') {
            filterWrapper.filter = new StringFilter(params);
        } else if (colDef.filter === 'number') {
            filterWrapper.filter = new NumberFilter(params);
        } else {
            filterWrapper.filter = new SetFilter(params);
        }
        this.allFilters[colDefWrapper.colKey] = filterWrapper;

        if (!filterWrapper.filter.getGui) { // because users can do custom filters, give nice error message
            console.error('Filter is missing method getGui');
        }

        var eFilterGui = document.createElement('div');
        eFilterGui.className = 'ag-filter';
        var guiFromFilter = filterWrapper.filter.getGui();
        if (utils.isNode(guiFromFilter) || utils.isElement(guiFromFilter)) {
            //a dom node or element was returned, so add child
            eFilterGui.appendChild(guiFromFilter);
        } else {
            //otherwise assume it was html, so just insert
            var eTextSpan = document.createElement('span');
            eTextSpan.innerHTML = guiFromFilter;
            eFilterGui.appendChild(eTextSpan);
        }

        if (filterWrapper.scope) {
            filterWrapper.gui = this.$compile(eFilterGui)(filterWrapper.scope)[0];
        } else {
            filterWrapper.gui = eFilterGui;
        }

    }

    var ePopupParent = this.grid.getPopupParent();
    this.positionPopup(eventSource, filterWrapper.gui, ePopupParent);

    utils.addAsModalPopup(ePopupParent, filterWrapper.gui);

    if (filterWrapper.filter.afterGuiAttached) {
        filterWrapper.filter.afterGuiAttached();
    }
};

module.exports = FilterManager;

},{"./../utils":24,"./numberFilter":5,"./setFilter":7,"./textFilter":10}],5:[function(require,module,exports){
var utils = require('./../utils');
var template = require('./numberFilterTemplate.js');

var EQUALS = 1;
var LESS_THAN = 2;
var GREATER_THAN = 3;

function NumberFilter(params) {
    this.filterChangedCallback = params.filterChangedCallback;
    this.createGui();
    this.filterNumber = null;
    this.filterType = EQUALS;
}

/* public */
NumberFilter.prototype.afterGuiAttached = function() {
    this.eFilterTextField.focus();
};

/* public */
NumberFilter.prototype.doesFilterPass = function(node) {
    if (this.filterNumber === null) {
        return true;
    }
    var value = node.value;

    if (!value && value !== 0) {
        return false;
    }

    var valueAsNumber;
    if (typeof value === 'number') {
        valueAsNumber = value;
    } else {
        valueAsNumber = parseFloat(value);
    }

    switch (this.filterType) {
        case EQUALS:
            return valueAsNumber === this.filterNumber;
        case LESS_THAN:
            return valueAsNumber <= this.filterNumber;
        case GREATER_THAN:
            return valueAsNumber >= this.filterNumber;
        default:
            // should never happen
            console.log('invalid filter type ' + this.filterType);
            return false;
    }
};

/* public */
NumberFilter.prototype.getGui = function() {
    return this.eGui;
};

/* public */
NumberFilter.prototype.isFilterActive = function() {
    return this.filterNumber !== null;
};

NumberFilter.prototype.createGui = function() {
    this.eGui = utils.loadTemplate(template);
    this.eFilterTextField = this.eGui.querySelector("#filterText");
    this.eTypeSelect = this.eGui.querySelector("#filterType");

    utils.addChangeListener(this.eFilterTextField, this.onFilterChanged.bind(this));
    this.eTypeSelect.addEventListener("change", this.onTypeChanged.bind(this));
};

NumberFilter.prototype.onTypeChanged = function() {
    this.filterType = parseInt(this.eTypeSelect.value);
    this.filterChangedCallback();
};

NumberFilter.prototype.onFilterChanged = function() {
    var filterText = utils.makeNull(this.eFilterTextField.value);
    if (filterText && filterText.trim() === '') {
        filterText = null;
    }
    if (filterText) {
        this.filterNumber = parseFloat(filterText);
    } else {
        this.filterNumber = null;
    }
    this.filterChangedCallback();
};

module.exports = NumberFilter;

},{"./../utils":24,"./numberFilterTemplate.js":6}],6:[function(require,module,exports){
var template = [
    '<div>',
    '<div>',
    '<select class="ag-filter-select" id="filterType">',
    '<option value="1">Equals</option>',
    '<option value="2">Less than</option>',
    '<option value="3">Greater than</option>',
    '</select>',
    '</div>',
    '<div>',
    '<input class="ag-filter-filter" id="filterText" type="text" placeholder="filter..."/>',
    '</div>',
    '</div>',
].join('');

module.exports = template;

},{}],7:[function(require,module,exports){
var utils = require('./../utils');
var SetFilterModel = require('./setFilterModel');
var template = require('./setFilterTemplate');

var DEFAULT_ROW_HEIGHT = 20;

function SetFilter(params) {
    var filterParams = params.filterParams;
    this.rowHeight = (filterParams && filterParams.cellHeight) ? filterParams.cellHeight : DEFAULT_ROW_HEIGHT;
    this.model = new SetFilterModel(params.colDef, params.rowModel);
    this.filterChangedCallback = params.filterChangedCallback;
    this.rowsInBodyContainer = {};
    this.colDef = params.colDef;
    if (filterParams) {
        this.cellRenderer = filterParams.cellRenderer;
    }
    this.createGui();
    this.addScrollListener();
}

// we need to have the gui attached before we can draw the virtual rows, as the
// virtual row logic needs info about the gui state
/* public */
SetFilter.prototype.afterGuiAttached = function() {
    this.drawVirtualRows();
};

/* public */
SetFilter.prototype.isFilterActive = function() {
    return this.model.isFilterActive();
};

/* public */
SetFilter.prototype.doesFilterPass = function(node) {
    var value = node.value;
    var model = node.model;
    //if no filter, always pass
    if (model.isEverythingSelected()) {
        return true;
    }
    //if nothing selected in filter, always fail
    if (model.isNothingSelected()) {
        return false;
    }

    value = utils.makeNull(value);
    var filterPassed = model.selectedValuesMap[value] !== undefined;
    return filterPassed;
};

/* public */
SetFilter.prototype.getGui = function() {
    return this.eGui;
};

/* public */
SetFilter.prototype.onNewRowsLoaded = function() {
    this.model.selectEverything();
    this.updateAllCheckboxes(true);
};

/* public */
SetFilter.prototype.getModel = function() {
    return this.model;
};

SetFilter.prototype.createGui = function() {
    var _this = this;

    this.eGui = utils.loadTemplate(template);

    this.eListContainer = this.eGui.querySelector(".ag-filter-list-container");
    this.eFilterValueTemplate = this.eGui.querySelector("#itemForRepeat");
    this.eSelectAll = this.eGui.querySelector("#selectAll");
    this.eListViewport = this.eGui.querySelector(".ag-filter-list-viewport");
    this.eMiniFilter = this.eGui.querySelector(".ag-filter-filter");
    this.eListContainer.style.height = (this.model.getUniqueValueCount() * this.rowHeight) + "px";

    this.setContainerHeight();
    this.eMiniFilter.value = this.model.getMiniFilter();
    utils.addChangeListener(this.eMiniFilter, function() {
        _this.onFilterChanged();
    });
    utils.removeAllChildren(this.eListContainer);

    this.eSelectAll.onclick = this.onSelectAll.bind(this);

    if (this.model.isEverythingSelected()) {
        this.eSelectAll.indeterminate = false;
        this.eSelectAll.checked = true;
    } else if (this.model.isNothingSelected()) {
        this.eSelectAll.indeterminate = false;
        this.eSelectAll.checked = false;
    } else {
        this.eSelectAll.indeterminate = true;
    }
};

SetFilter.prototype.setContainerHeight = function() {
    this.eListContainer.style.height = (this.model.getDisplayedValueCount() * this.rowHeight) + "px";
};

SetFilter.prototype.drawVirtualRows = function() {
    var topPixel = this.eListViewport.scrollTop;
    var bottomPixel = topPixel + this.eListViewport.offsetHeight;

    var firstRow = Math.floor(topPixel / this.rowHeight);
    var lastRow = Math.floor(bottomPixel / this.rowHeight);

    this.ensureRowsRendered(firstRow, lastRow);
};

SetFilter.prototype.ensureRowsRendered = function(start, finish) {
    var _this = this;

    //at the end, this array will contain the items we need to remove
    var rowsToRemove = Object.keys(this.rowsInBodyContainer);

    //add in new rows
    for (var rowIndex = start; rowIndex <= finish; rowIndex++) {
        //see if item already there, and if yes, take it out of the 'to remove' array
        if (rowsToRemove.indexOf(rowIndex.toString()) >= 0) {
            rowsToRemove.splice(rowsToRemove.indexOf(rowIndex.toString()), 1);
            continue;
        }
        //check this row actually exists (in case overflow buffer window exceeds real data)
        if (this.model.getDisplayedValueCount() > rowIndex) {
            var value = this.model.getDisplayedValue(rowIndex);
            _this.insertRow(value, rowIndex);
        }
    }

    //at this point, everything in our 'rowsToRemove' . . .
    this.removeVirtualRows(rowsToRemove);
};

//takes array of row id's
SetFilter.prototype.removeVirtualRows = function(rowsToRemove) {
    var _this = this;
    rowsToRemove.forEach(function(indexToRemove) {
        var eRowToRemove = _this.rowsInBodyContainer[indexToRemove];
        _this.eListContainer.removeChild(eRowToRemove);
        delete _this.rowsInBodyContainer[indexToRemove];
    });
};

SetFilter.prototype.insertRow = function(value, rowIndex) {
    var _this = this;

    var eFilterValue = this.eFilterValueTemplate.cloneNode(true);

    var valueElement = eFilterValue.querySelector(".ag-filter-value");
    if (this.cellRenderer) {
        //renderer provided, so use it
        var resultFromRenderer = this.cellRenderer({
            value: value
        });

        if (utils.isNode(resultFromRenderer) || utils.isElement(resultFromRenderer)) {
            //a dom node or element was returned, so add child
            valueElement.appendChild(resultFromRenderer);
        } else {
            //otherwise assume it was html, so just insert
            valueElement.innerHTML = resultFromRenderer;
        }

    } else {
        //otherwise display as a string
        var displayNameOfValue = value === null ? "(Blanks)" : value;
        valueElement.innerHTML = displayNameOfValue;
    }
    var eCheckbox = eFilterValue.querySelector("input");
    eCheckbox.checked = this.model.isValueSelected(value);

    eCheckbox.onclick = function() {
        _this.onCheckboxClicked(eCheckbox, value);
    }

    eFilterValue.style.top = (this.rowHeight * rowIndex) + "px";

    this.eListContainer.appendChild(eFilterValue);
    this.rowsInBodyContainer[rowIndex] = eFilterValue;
};

SetFilter.prototype.onCheckboxClicked = function(eCheckbox, value) {
    var checked = eCheckbox.checked;
    if (checked) {
        this.model.selectValue(value);
        if (this.model.isEverythingSelected()) {
            this.eSelectAll.indeterminate = false;
            this.eSelectAll.checked = true;
        } else {
            this.eSelectAll.indeterminate = true;
        }
    } else {
        this.model.unselectValue(value);
        //if set is empty, nothing is selected
        if (this.model.isNothingSelected()) {
            this.eSelectAll.indeterminate = false;
            this.eSelectAll.checked = false;
        } else {
            this.eSelectAll.indeterminate = true;
        }
    }

    this.filterChangedCallback();
};

SetFilter.prototype.onFilterChanged = function() {
    var miniFilterChanged = this.model.setMiniFilter(this.eMiniFilter.value);
    if (miniFilterChanged) {
        this.setContainerHeight();
        this.clearVirtualRows();
        this.drawVirtualRows();
    }
};

SetFilter.prototype.clearVirtualRows = function() {
    var rowsToRemove = Object.keys(this.rowsInBodyContainer);
    this.removeVirtualRows(rowsToRemove);
};

SetFilter.prototype.onSelectAll = function() {
    var checked = this.eSelectAll.checked;
    if (checked) {
        this.model.selectEverything();
    } else {
        this.model.selectNothing();
    }
    this.updateAllCheckboxes(checked);
    this.filterChangedCallback();
};

SetFilter.prototype.updateAllCheckboxes = function(checked) {
    var currentlyDisplayedCheckboxes = this.eListContainer.querySelectorAll("[filter-checkbox=true]");
    for (var i = 0, l = currentlyDisplayedCheckboxes.length; i < l; i++) {
        currentlyDisplayedCheckboxes[i].checked = checked;
    }
};

SetFilter.prototype.addScrollListener = function() {
    var _this = this;

    this.eListViewport.addEventListener("scroll", function() {
        _this.drawVirtualRows();
    });
};

module.exports = SetFilter;

},{"./../utils":24,"./setFilterModel":8,"./setFilterTemplate":9}],8:[function(require,module,exports){
    var utils = require('../utils');

    function SetFilterModel(colDef, rowModel) {

        if (colDef.filterParams && colDef.filterParams.values) {
            this.uniqueValues = colDef.filterParams.values;
        } else {
            this.createUniqueValues(rowModel, colDef.field);
        }

        if (colDef.comparator) {
            this.uniqueValues.sort(colDef.comparator);
        } else {
            this.uniqueValues.sort(utils.defaultComparator);
        }

        this.displayedValues = this.uniqueValues;
        this.miniFilter = null;
        //we use a map rather than an array for the selected values as the lookup
        //for a map is much faster than the lookup for an array, especially when
        //the length of the array is thousands of records long
        this.selectedValuesMap = {};
        this.selectEverything();
    }

    SetFilterModel.prototype.createUniqueValues = function(rowModel, key) {
        var uniqueCheck = {};
        var result = [];
        for (var i = 0, l = rowModel.getVirtualRowCount(); i < l; i++) {
            var data = rowModel.getVirtualRow(i).data;
            var value = data ? data[key] : null;
            if (value === "" || value === undefined) {
                value = null;
            }
            if (!uniqueCheck.hasOwnProperty(value)) {
                result.push(value);
                uniqueCheck[value] = 1;
            }
        }
        this.uniqueValues = result;
    };

    //sets mini filter. returns true if it changed from last value, otherwise false
    SetFilterModel.prototype.setMiniFilter = function(newMiniFilter) {
        newMiniFilter = utils.makeNull(newMiniFilter);
        if (this.miniFilter === newMiniFilter) {
            //do nothing if filter has not changed
            return false;
        }
        this.miniFilter = newMiniFilter;
        this.filterDisplayedValues();
        return true;
    };

    SetFilterModel.prototype.getMiniFilter = function() {
        return this.miniFilter;
    };

    SetFilterModel.prototype.filterDisplayedValues = function() {
        // if no filter, just use the unique values
        if (this.miniFilter === null) {
            this.displayedValues = this.uniqueValues;
            return;
        }

        // if filter present, we filter down the list
        this.displayedValues = [];
        var miniFilterUpperCase = this.miniFilter.toUpperCase();
        for (var i = 0, l = this.uniqueValues.length; i < l; i++) {
            var uniqueValue = this.uniqueValues[i];
            if (uniqueValue !== null && uniqueValue.toString().toUpperCase().indexOf(miniFilterUpperCase) >= 0) {
                this.displayedValues.push(uniqueValue);
            }
        }

    };

    SetFilterModel.prototype.getDisplayedValueCount = function() {
        return this.displayedValues.length;
    };

    SetFilterModel.prototype.getDisplayedValue = function(index) {
        return this.displayedValues[index];
    };

    SetFilterModel.prototype.selectEverything = function() {
        var count = this.uniqueValues.length;
        for (var i = 0; i < count; i++) {
            var value = this.uniqueValues[i];
            this.selectedValuesMap[value] = null;
        }
        this.selectedValuesCount = count;
    };

    SetFilterModel.prototype.isFilterActive = function() {
        return this.uniqueValues.length !== this.selectedValuesCount;
    };

    SetFilterModel.prototype.selectNothing = function() {
        this.selectedValuesMap = {};
        this.selectedValuesCount = 0;
    };

    SetFilterModel.prototype.getUniqueValueCount = function() {
        return this.uniqueValues.length;
    };

    SetFilterModel.prototype.unselectValue = function(value) {
        if (this.selectedValuesMap[value] !== undefined) {
            delete this.selectedValuesMap[value];
            this.selectedValuesCount--;
        }
    };

    SetFilterModel.prototype.selectValue = function(value) {
        if (this.selectedValuesMap[value] === undefined) {
            this.selectedValuesMap[value] = null;
            this.selectedValuesCount++;
        }
    };

    SetFilterModel.prototype.isValueSelected = function(value) {
        return this.selectedValuesMap[value] !== undefined;
    };

    SetFilterModel.prototype.isEverythingSelected = function() {
        return this.uniqueValues.length === this.selectedValuesCount;
    };

    SetFilterModel.prototype.isNothingSelected = function() {
        return this.uniqueValues.length === 0;
    };

    module.exports = SetFilterModel;

},{"../utils":24}],9:[function(require,module,exports){
var template = [
    '<div>',
    '    <div class="ag-filter-header-container">',
    '        <input class="ag-filter-filter" type="text" placeholder="search..."/>',
    '    </div>',
    '    <div class="ag-filter-header-container">',
    '        <label>',
    '            <input id="selectAll" type="checkbox" class="ag-filter-checkbox"/>',
    '            (Select All)',
    '        </label>',
    '    </div>',
    '    <div class="ag-filter-list-viewport">',
    '        <div class="ag-filter-list-container">',
    '            <div id="itemForRepeat" class="ag-filter-item">',
    '                <label>',
    '                    <input type="checkbox" class="ag-filter-checkbox" filter-checkbox="true"/>',
    '                    <span class="ag-filter-value"></span>',
    '                </label>',
    '            </div>',
    '        </div>',
    '    </div>',
    '</div>',
].join('');

module.exports = template;

},{}],10:[function(require,module,exports){
var utils = require('../utils');
var template = require('./textFilterTemplate');

var CONTAINS = 1;
var EQUALS = 2;
var STARTS_WITH = 3;
var ENDS_WITH = 4;

function TextFilter(params) {
    this.filterChangedCallback = params.filterChangedCallback;
    this.createGui();
    this.filterText = null;
    this.filterType = CONTAINS;
}

/* public */
TextFilter.prototype.afterGuiAttached = function() {
    this.eFilterTextField.focus();
};

/* public */
TextFilter.prototype.doesFilterPass = function(node) {
    if (!this.filterText) {
        return true;
    }
    var value = node.value;
    if (!value) {
        return false;
    }
    var valueLowerCase = value.toString().toLowerCase();
    switch (this.filterType) {
        case CONTAINS:
            return valueLowerCase.indexOf(this.filterText) >= 0;
        case EQUALS:
            return valueLowerCase === this.filterText;
        case STARTS_WITH:
            return valueLowerCase.indexOf(this.filterText) === 0;
        case ENDS_WITH:
            var index = valueLowerCase.indexOf(this.filterText);
            return index >= 0 && index === (valueLowerCase.length - this.filterText.length);
        default:
            // should never happen
            console.log('invalid filter type ' + this.filterType);
            return false;
    }
};

/* public */
TextFilter.prototype.getGui = function() {
    return this.eGui;
};

/* public */
TextFilter.prototype.isFilterActive = function() {
    return this.filterText !== null;
};

TextFilter.prototype.createGui = function() {
    this.eGui = utils.loadTemplate(template);
    this.eFilterTextField = this.eGui.querySelector("#filterText");
    this.eTypeSelect = this.eGui.querySelector("#filterType");

    utils.addChangeListener(this.eFilterTextField, this.onFilterChanged.bind(this));
    this.eTypeSelect.addEventListener("change", this.onTypeChanged.bind(this));
};

TextFilter.prototype.onTypeChanged = function() {
    this.filterType = parseInt(this.eTypeSelect.value);
    this.filterChangedCallback();
};

TextFilter.prototype.onFilterChanged = function() {
    var filterText = utils.makeNull(this.eFilterTextField.value);
    if (filterText && filterText.trim() === '') {
        filterText = null;
    }
    if (filterText) {
        this.filterText = filterText.toLowerCase();
    } else {
        this.filterText = null;
    }
    this.filterChangedCallback();
};

module.exports = TextFilter;

},{"../utils":24,"./textFilterTemplate":11}],11:[function(require,module,exports){
var template = [
    '<div>',
    '<div>',
    '<select class="ag-filter-select" id="filterType">',
    '<option value="1">Contains</option>',
    '<option value="2">Equals</option>',
    '<option value="3">Starts with</option>',
    '<option value="4">Ends with</option>',
    '</select>',
    '</div>',
    '<div>',
    '<input class="ag-filter-filter" id="filterText" type="text" placeholder="filter..."/>',
    '</div>',
    '</div>',
].join('');

module.exports = template;

},{}],12:[function(require,module,exports){
var constants = require('./constants');
var GridOptionsWrapper = require('./gridOptionsWrapper');
var template = require('./template.js');
var templateNoScrolls = require('./templateNoScrolls.js');
var SelectionController = require('./selectionController');
var FilterManager = require('./filter/filterManager');
var SelectionRendererFactory = require('./selectionRendererFactory');
var ColumnController = require('./columnController');
var RowRenderer = require('./rowRenderer');
var HeaderRenderer = require('./headerRenderer');
var InMemoryRowController = require('./inMemoryRowController');
var VirtualPageRowController = require('./virtualPageRowController');
var PaginationController = require('./paginationController');

function Grid(eGridDiv, gridOptions, $scope, $compile) {

    this.gridOptions = gridOptions;
    this.gridOptionsWrapper = new GridOptionsWrapper(this.gridOptions);

    var useScrolls = !this.gridOptionsWrapper.isDontUseScrolls();
    if (useScrolls) {
        eGridDiv.innerHTML = template;
    } else {
        eGridDiv.innerHTML = templateNoScrolls;
    }

    var that = this;
    this.quickFilter = null;

    // if using angular, watch for quickFilter changes
    if ($scope) {
        $scope.$watch("angularGrid.quickFilterText", function(newFilter) {
            that.onQuickFilterChanged(newFilter);
        });
    }

    this.virtualRowCallbacks = {};

    this.addApi();
    this.findAllElements(eGridDiv);
    this.createAndWireBeans($scope, $compile, eGridDiv, useScrolls);

    this.inMemoryRowController.setAllRows(this.gridOptionsWrapper.getAllRows());

    if (useScrolls) {
        this.addScrollListener();
        this.setBodySize(); //setting sizes of body (containing viewports), doesn't change container sizes
    }

    // done when cols change
    this.setupColumns();

    // done when rows change
    this.updateModelAndRefresh(constants.STEP_EVERYTHING);

    // flag to mark when the directive is destroyed
    this.finished = false;

    // if no data provided initially, and not doing infinite scrolling, show the loading panel
    var showLoading = !this.gridOptionsWrapper.getAllRows() && !this.gridOptionsWrapper.isVirtualPaging();
    this.showLoadingPanel(showLoading);

    // if datasource provided, use it
    if (this.gridOptionsWrapper.getDatasource()) {
        this.setDatasource();
    }
}

Grid.prototype.createAndWireBeans = function($scope, $compile, eGridDiv, useScrolls) {

    // make local references, to make the below more human readable
    var gridOptionsWrapper = this.gridOptionsWrapper;
    var gridOptions = this.gridOptions;

    // create all the beans
    var selectionController = new SelectionController();
    var filterManager = new FilterManager();
    var selectionRendererFactory = new SelectionRendererFactory();
    var columnController = new ColumnController();
    var rowRenderer = new RowRenderer();
    var headerRenderer = new HeaderRenderer();
    var inMemoryRowController = new InMemoryRowController();
    var virtualPageRowController = new VirtualPageRowController();

    var columnModel = columnController.getModel();

    // initialise all the beans
    selectionController.init(this, this.eParentOfRows, gridOptionsWrapper, $scope, rowRenderer);
    filterManager.init(this, gridOptionsWrapper, $compile, $scope);
    selectionRendererFactory.init(this, selectionController);
    columnController.init(this, selectionRendererFactory, gridOptionsWrapper);
    rowRenderer.init(gridOptions, columnModel, gridOptionsWrapper, eGridDiv, this,
        selectionRendererFactory, $compile, $scope, selectionController);
    headerRenderer.init(gridOptionsWrapper, columnController, columnModel, eGridDiv, this, filterManager, $scope, $compile);
    inMemoryRowController.init(gridOptionsWrapper, columnModel, this, filterManager, $scope);
    virtualPageRowController.init(rowRenderer);

    // this is a child bean, get a reference and pass it on
    // CAN WE DELETE THIS? it's done in the setDatasource section
    var rowModel = inMemoryRowController.getModel();
    selectionController.setRowModel(rowModel);
    filterManager.setRowModel(rowModel);
    rowRenderer.setRowModel(rowModel);

    // and the last bean, done in it's own section, as it's optional
    var paginationController = null;
    if (useScrolls) {
        paginationController = new PaginationController();
        paginationController.init(this.ePagingPanel, this);
    }

    this.rowModel = rowModel;
    this.selectionController = selectionController;
    this.columnController = columnController;
    this.columnModel = columnModel;
    this.inMemoryRowController = inMemoryRowController;
    this.virtualPageRowController = virtualPageRowController;
    this.rowRenderer = rowRenderer;
    this.headerRenderer = headerRenderer;
    this.paginationController = paginationController;
    this.filterManager = filterManager;
};

Grid.prototype.showAndPositionPagingPanel = function() {
    // no paging when no-scrolls
    if (!this.ePagingPanel) {
        return;
    }

    if (this.isShowPagingPanel()) {
        this.ePagingPanel.style['display'] = null;
        var heightOfPager = this.ePagingPanel.offsetHeight;
        this.eBody.style['padding-bottom'] = heightOfPager + 'px';
        var heightOfRoot = this.eRoot.clientHeight;
        var topOfPager = heightOfRoot - heightOfPager;
        this.ePagingPanel.style['top'] = topOfPager + 'px';
    } else {
        this.ePagingPanel.style['display'] = 'none';
        this.eBody.style['padding-bottom'] = null;
    }

};

Grid.prototype.isShowPagingPanel = function() {
    return this.showPagingPanel;
};

Grid.prototype.setDatasource = function(datasource) {
    // if datasource provided, then set it
    if (datasource) {
        this.gridOptions.datasource = datasource;
    }
    // get the set datasource (if null was passed to this method,
    // then need to get the actual datasource from options
    var datasourceToUse = this.gridOptionsWrapper.getDatasource();
    var virtualPaging = this.gridOptionsWrapper.isVirtualPaging() && datasourceToUse;
    var pagination = datasourceToUse && !virtualPaging;

    if (virtualPaging) {
        this.paginationController.setDatasource(null);
        this.virtualPageRowController.setDatasource(datasourceToUse);
        this.rowModel = this.virtualPageRowController.getModel();
        this.showPagingPanel = false;
    } else if (pagination) {
        this.paginationController.setDatasource(datasourceToUse);
        this.virtualPageRowController.setDatasource(null);
        this.rowModel = this.inMemoryRowController.getModel();
        this.showPagingPanel = true;
    } else {
        this.paginationController.setDatasource(null);
        this.virtualPageRowController.setDatasource(null);
        this.rowModel = this.inMemoryRowController.getModel();
        this.showPagingPanel = false;
    }

    this.selectionController.setRowModel(this.rowModel);
    this.filterManager.setRowModel(this.rowModel);
    this.rowRenderer.setRowModel(this.rowModel);

    // we may of just shown or hidden the paging panel, so need
    // to get table to check the body size, which also hides and
    // shows the paging panel.
    this.setBodySize();

    // because we just set the rowModel, need to update the gui
    this.rowRenderer.refreshView();
};

// gets called after columns are shown / hidden from groups expanding
Grid.prototype.refreshHeaderAndBody = function() {
    this.headerRenderer.refreshHeader();
    this.headerRenderer.updateFilterIcons();
    this.setBodyContainerWidth();
    this.setPinnedColContainerWidth();
    this.rowRenderer.refreshView();
};

Grid.prototype.setFinished = function() {
    this.finished = true;
};

Grid.prototype.getPopupParent = function() {
    return this.eRoot;
};

Grid.prototype.getQuickFilter = function() {
    return this.quickFilter;
};

Grid.prototype.onQuickFilterChanged = function(newFilter) {
    if (newFilter === undefined || newFilter === "") {
        newFilter = null;
    }
    if (this.quickFilter !== newFilter) {
        //want 'null' to mean to filter, so remove undefined and empty string
        if (newFilter === undefined || newFilter === "") {
            newFilter = null;
        }
        if (newFilter !== null) {
            newFilter = newFilter.toUpperCase();
        }
        this.quickFilter = newFilter;
        this.onFilterChanged();
    }
};

Grid.prototype.onFilterChanged = function() {
    this.updateModelAndRefresh(constants.STEP_FILTER);
    this.headerRenderer.updateFilterIcons();
};

Grid.prototype.onRowClicked = function(event, rowIndex, node) {

    if (this.gridOptions.rowClicked) {
        var params = {
            node: node,
            data: node.data,
            event: event
        };
        this.gridOptions.rowClicked(params);
    }

    // we do not allow selecting groups by clicking (as the click here expands the group)
    // so return if it's a group row
    if (node.group) {
        return;
    }

    // if no selection method enabled, do nothing
    if (!this.gridOptionsWrapper.isRowSelection()) {
        return;
    }

    // if click selection suppressed, do nothing
    if (this.gridOptionsWrapper.isSuppressRowClickSelection()) {
        return;
    }

    // ctrlKey for windows, metaKey for Apple
    var tryMulti = event.ctrlKey || event.metaKey;
    this.selectionController.selectNode(node, tryMulti);
};

Grid.prototype.setHeaderHeight = function() {
    var headerHeight = this.gridOptionsWrapper.getHeaderHeight();
    var headerHeightPixels = headerHeight + 'px';
    var dontUseScrolls = this.gridOptionsWrapper.isDontUseScrolls();
    if (dontUseScrolls) {
        this.eHeaderContainer.style['height'] = headerHeightPixels;
    } else {
        this.eHeader.style['height'] = headerHeightPixels;
        this.eBody.style['padding-top'] = headerHeightPixels;
        this.eLoadingPanel.style['margin-top'] = headerHeightPixels;
    }
};

Grid.prototype.showLoadingPanel = function(show) {
    if (show) {
        // setting display to null, actually has the impact of setting it
        // to 'table', as this is part of the ag-loading-panel core style
        this.eLoadingPanel.style.display = null;
    } else {
        this.eLoadingPanel.style.display = 'none';
    }
};

Grid.prototype.setupColumns = function() {
    this.setHeaderHeight();
    this.columnController.setColumns(this.gridOptions.columnDefs);
    this.showPinnedColContainersIfNeeded();
    this.headerRenderer.refreshHeader();
    if (!this.gridOptionsWrapper.isDontUseScrolls()) {
        this.setPinnedColContainerWidth();
        this.setBodyContainerWidth();
    }
    this.headerRenderer.updateFilterIcons();
};

Grid.prototype.setBodyContainerWidth = function() {
    var mainRowWidth = this.columnModel.getBodyContainerWidth() + "px";
    this.eBodyContainer.style.width = mainRowWidth;
};

Grid.prototype.updateModelAndRefresh = function(step) {
    this.inMemoryRowController.updateModel(step);
    this.rowRenderer.refreshView();
};

Grid.prototype.setRows = function(rows, firstId) {
    if (rows) {
        this.gridOptions.rowData = rows;
    }
    this.inMemoryRowController.setAllRows(this.gridOptionsWrapper.getAllRows(), firstId);
    this.selectionController.clearSelection();
    this.filterManager.onNewRowsLoaded();
    this.updateModelAndRefresh(constants.STEP_EVERYTHING);
    this.headerRenderer.updateFilterIcons();
    this.showLoadingPanel(false);
};

Grid.prototype.addApi = function() {
    var that = this;
    var api = {
        setDatasource: function(datasource) {
            that.setDatasource(datasource);
        },
        onNewDatasource: function() {
            that.setDatasource();
        },
        setRows: function(rows) {
            that.setRows(rows);
        },
        onNewRows: function() {
            that.setRows();
        },
        onNewCols: function() {
            that.onNewCols();
        },
        unselectAll: function() {
            that.selectionController.clearSelection();
            that.rowRenderer.refreshView();
        },
        refreshView: function() {
            that.rowRenderer.refreshView();
        },
        refreshHeader: function() {
            // need to review this - the refreshHeader should also refresh all icons in the header
            that.headerRenderer.refreshHeader();
            that.headerRenderer.updateFilterIcons();
        },
        getModel: function() {
            return that.rowModel;
        },
        onGroupExpandedOrCollapsed: function() {
            that.updateModelAndRefresh(constants.STEP_MAP);
        },
        expandAll: function() {
            that.inMemoryRowController.expandOrCollapseAll(true, null);
            that.updateModelAndRefresh(constants.STEP_MAP);
        },
        collapseAll: function() {
            that.inMemoryRowController.expandOrCollapseAll(false, null);
            that.updateModelAndRefresh(constants.STEP_MAP);
        },
        addVirtualRowListener: function(rowIndex, callback) {
            that.addVirtualRowListener(rowIndex, callback);
        },
        rowDataChanged: function(rows) {
            that.rowRenderer.rowDataChanged(rows);
        },
        setQuickFilter: function(newFilter) {
            that.onQuickFilterChanged(newFilter)
        },
        selectIndex: function(index, tryMulti, suppressEvents) {
            that.selectionController.selectIndex(index, tryMulti, suppressEvents);
        },
        deselectIndex: function(index) {
            that.selectionController.deselectIndex(index);
        },
        selectNode: function(node, tryMulti, suppressEvents) {
            that.selectionController.selectNode(node, tryMulti, suppressEvents);
        },
        deselectNode: function(node) {
            that.selectionController.deselectNode(node);
        },
        recomputeAggregates: function() {
            that.inMemoryRowController.doAggregate();
            that.rowRenderer.refreshGroupRows();
        },
        sizeColumnsToFit: function() {
            var availableWidth = that.eBody.clientWidth;
            that.columnController.sizeColumnsToFit(availableWidth);
        },
        showLoading: function(show) {
            that.showLoadingPanel(show);
        },
        isNodeSelected: function(node) {
            return that.selectionController.isNodeSelected(node);
        },
        getSelectedNodes: function() {
            return that.selectionController.getSelectedNodes();
        },
        getBestCostNodeSelection: function() {
            return that.selectionController.getBestCostNodeSelection();
        }
    };
    this.gridOptions.api = api;
};

Grid.prototype.addVirtualRowListener = function(rowIndex, callback) {
    if (!this.virtualRowCallbacks[rowIndex]) {
        this.virtualRowCallbacks[rowIndex] = [];
    }
    this.virtualRowCallbacks[rowIndex].push(callback);
};

Grid.prototype.onVirtualRowSelected = function(rowIndex, selected) {
    // inform the callbacks of the event
    if (this.virtualRowCallbacks[rowIndex]) {
        this.virtualRowCallbacks[rowIndex].forEach(function(callback) {
            if (typeof callback.rowRemoved === 'function') {
                callback.rowSelected(selected);
            }
        });
    }
};

Grid.prototype.onVirtualRowRemoved = function(rowIndex) {
    // inform the callbacks of the event
    if (this.virtualRowCallbacks[rowIndex]) {
        this.virtualRowCallbacks[rowIndex].forEach(function(callback) {
            if (typeof callback.rowRemoved === 'function') {
                callback.rowRemoved();
            }
        });
    }
    // remove the callbacks
    delete this.virtualRowCallbacks[rowIndex];
};

Grid.prototype.onNewCols = function() {
    this.setupColumns();
    this.updateModelAndRefresh(constants.STEP_EVERYTHING);
};

Grid.prototype.findAllElements = function(eGridDiv) {
    if (this.gridOptionsWrapper.isDontUseScrolls()) {
        this.eRoot = eGridDiv.querySelector(".ag-root");
        this.eHeaderContainer = eGridDiv.querySelector(".ag-header-container");
        this.eBodyContainer = eGridDiv.querySelector(".ag-body-container");
        this.eLoadingPanel = eGridDiv.querySelector('.ag-loading-panel');
        // for no-scrolls, all rows live in the body container
        this.eParentOfRows = this.eBodyContainer;
    } else {
        this.eRoot = eGridDiv.querySelector(".ag-root");
        this.eBody = eGridDiv.querySelector(".ag-body");
        this.eBodyContainer = eGridDiv.querySelector(".ag-body-container");
        this.eBodyViewport = eGridDiv.querySelector(".ag-body-viewport");
        this.eBodyViewportWrapper = eGridDiv.querySelector(".ag-body-viewport-wrapper");
        this.ePinnedColsContainer = eGridDiv.querySelector(".ag-pinned-cols-container");
        this.ePinnedColsViewport = eGridDiv.querySelector(".ag-pinned-cols-viewport");
        this.ePinnedHeader = eGridDiv.querySelector(".ag-pinned-header");
        this.eHeader = eGridDiv.querySelector(".ag-header");
        this.eHeaderContainer = eGridDiv.querySelector(".ag-header-container");
        this.eLoadingPanel = eGridDiv.querySelector('.ag-loading-panel');
        // for scrolls, all rows live in eBody (containing pinned and normal body)
        this.eParentOfRows = this.eBody;
        this.ePagingPanel = eGridDiv.querySelector('.ag-paging-panel');
    }
};

Grid.prototype.showPinnedColContainersIfNeeded = function() {
    // no need to do this if not using scrolls
    if (this.gridOptionsWrapper.isDontUseScrolls()) {
        return;
    }

    var showingPinnedCols = this.gridOptionsWrapper.getPinnedColCount() > 0;

    //some browsers had layout issues with the blank divs, so if blank,
    //we don't display them
    if (showingPinnedCols) {
        this.ePinnedHeader.style.display = 'inline-block';
        this.ePinnedColsViewport.style.display = 'inline';
    } else {
        this.ePinnedHeader.style.display = 'none';
        this.ePinnedColsViewport.style.display = 'none';
    }
};

Grid.prototype.updateBodyContainerWidthAfterColResize = function() {
    this.rowRenderer.setMainRowWidths();
    this.setBodyContainerWidth();
};

Grid.prototype.updatePinnedColContainerWidthAfterColResize = function() {
    this.setPinnedColContainerWidth();
};

Grid.prototype.setPinnedColContainerWidth = function() {
    var pinnedColWidth = this.columnModel.getPinnedContainerWidth() + "px";
    this.ePinnedColsContainer.style.width = pinnedColWidth;
    this.eBodyViewportWrapper.style.marginLeft = pinnedColWidth;
};

// see if a grey box is needed at the bottom of the pinned col
Grid.prototype.setPinnedColHeight = function() {
    // var bodyHeight = utils.pixelStringToNumber(this.eBody.style.height);
    var scrollShowing = this.eBodyViewport.clientWidth < this.eBodyViewport.scrollWidth;
    var bodyHeight = this.eBodyViewport.offsetHeight;
    if (scrollShowing) {
        this.ePinnedColsViewport.style.height = (bodyHeight - 20) + "px";
    } else {
        this.ePinnedColsViewport.style.height = bodyHeight + "px";
    }
    // also the loading overlay, needs to have it's height adjusted
    this.eLoadingPanel.style.height = bodyHeight + 'px';
};

Grid.prototype.setBodySize = function() {
    var _this = this;

    var bodyHeight = this.eBodyViewport.offsetHeight;
    var pagingVisible = this.isShowPagingPanel();

    if (this.bodyHeightLastTime != bodyHeight || this.showPagingPanelVisibleLastTime != pagingVisible) {
        this.bodyHeightLastTime = bodyHeight;
        this.showPagingPanelVisibleLastTime = pagingVisible;

        this.setPinnedColHeight();

        //only draw virtual rows if done sort & filter - this
        //means we don't draw rows if table is not yet initialised
        if (this.rowModel.getVirtualRowCount() > 0) {
            this.rowRenderer.drawVirtualRows();
        }

        // show and position paging panel
        this.showAndPositionPagingPanel();
    }

    if (!this.finished) {
        setTimeout(function() {
            _this.setBodySize();
        }, 200);
    }
};

Grid.prototype.addScrollListener = function() {
    var _this = this;

    this.eBodyViewport.addEventListener("scroll", function() {
        _this.scrollHeaderAndPinned();
        _this.rowRenderer.drawVirtualRows();
    });
};

Grid.prototype.scrollHeaderAndPinned = function() {
    this.eHeaderContainer.style.left = -this.eBodyViewport.scrollLeft + "px";
    this.ePinnedColsContainer.style.top = -this.eBodyViewport.scrollTop + "px";
};

module.exports = Grid;

},{"./columnController":2,"./constants":3,"./filter/filterManager":4,"./gridOptionsWrapper":13,"./headerRenderer":15,"./inMemoryRowController":16,"./paginationController":17,"./rowRenderer":18,"./selectionController":19,"./selectionRendererFactory":20,"./template.js":22,"./templateNoScrolls.js":23,"./virtualPageRowController":25}],13:[function(require,module,exports){
var DEFAULT_ROW_HEIGHT = 30;

function GridOptionsWrapper(gridOptions) {
    this.gridOptions = gridOptions;
    this.setupDefaults();
}

function isTrue(value) {
    return value === true || value === 'true';
}

GridOptionsWrapper.prototype.isRowSelection = function() {
    return this.gridOptions.rowSelection === "single" || this.gridOptions.rowSelection === "multiple";
};
GridOptionsWrapper.prototype.isRowSelectionMulti = function() {
    return this.gridOptions.rowSelection === 'multiple';
};
GridOptionsWrapper.prototype.getContext = function() {
    return this.gridOptions.context;
};
GridOptionsWrapper.prototype.isVirtualPaging = function() {
    return isTrue(this.gridOptions.virtualPaging);
};
GridOptionsWrapper.prototype.isRowsAlreadyGrouped = function() {
    return isTrue(this.gridOptions.rowsAlreadyGrouped);
};
GridOptionsWrapper.prototype.isGroupCheckboxSelectionGroup = function() {
    return this.gridOptions.groupCheckboxSelection === 'group';
};
GridOptionsWrapper.prototype.isGroupCheckboxSelectionChildren = function() {
    return this.gridOptions.groupCheckboxSelection === 'children';
};
GridOptionsWrapper.prototype.isGroupIncludeFooter = function() {
    return isTrue(this.gridOptions.groupIncludeFooter);
};
GridOptionsWrapper.prototype.isSuppressRowClickSelection = function() {
    return isTrue(this.gridOptions.suppressRowClickSelection);
};
GridOptionsWrapper.prototype.isGroupHeaders = function() {
    return isTrue(this.gridOptions.groupHeaders);
};
GridOptionsWrapper.prototype.isDontUseScrolls = function() {
    return isTrue(this.gridOptions.dontUseScrolls);
};
GridOptionsWrapper.prototype.getRowStyle = function() {
    return this.gridOptions.rowStyle;
};
GridOptionsWrapper.prototype.getRowClass = function() {
    return this.gridOptions.rowClass;
};
GridOptionsWrapper.prototype.getGridOptions = function() {
    return this.gridOptions;
};
GridOptionsWrapper.prototype.getHeaderCellRenderer = function() {
    return this.gridOptions.headerCellRenderer;
};
GridOptionsWrapper.prototype.isEnableSorting = function() {
    return this.gridOptions.enableSorting;
};
GridOptionsWrapper.prototype.isEnableColResize = function() {
    return this.gridOptions.enableColResize;
};
GridOptionsWrapper.prototype.isEnableFilter = function() {
    return this.gridOptions.enableFilter;
};
GridOptionsWrapper.prototype.getGroupDefaultExpanded = function() {
    return this.gridOptions.groupDefaultExpanded;
};
GridOptionsWrapper.prototype.getGroupKeys = function() {
    return this.gridOptions.groupKeys;
};
GridOptionsWrapper.prototype.getGroupIconRenderer = function() {
    return this.gridOptions.groupIconRenderer;
};
GridOptionsWrapper.prototype.getGroupAggFunction = function() {
    return this.gridOptions.groupAggFunction;
};
GridOptionsWrapper.prototype.getAllRows = function() {
    return this.gridOptions.rowData;
};
GridOptionsWrapper.prototype.isGroupUseEntireRow = function() {
    return isTrue(this.gridOptions.groupUseEntireRow);
};
GridOptionsWrapper.prototype.isAngularCompileRows = function() {
    return isTrue(this.gridOptions.angularCompileRows);
};
GridOptionsWrapper.prototype.isAngularCompileFilters = function() {
    return isTrue(this.gridOptions.angularCompileFilters);
};
GridOptionsWrapper.prototype.isAngularCompileHeaders = function() {
    return isTrue(this.gridOptions.angularCompileHeaders);
};
GridOptionsWrapper.prototype.getColumnDefs = function() {
    return this.gridOptions.columnDefs;
};
GridOptionsWrapper.prototype.getRowHeight = function() {
    return this.gridOptions.rowHeight;
};
GridOptionsWrapper.prototype.getModelUpdated = function() {
    return this.gridOptions.modelUpdated;
};
GridOptionsWrapper.prototype.getCellClicked = function() {
    return this.gridOptions.cellClicked;
};
GridOptionsWrapper.prototype.getCellDoubleClicked = function() {
    return this.gridOptions.cellDoubleClicked;
};
GridOptionsWrapper.prototype.getRowSelected = function() {
    return this.gridOptions.rowSelected;
};
GridOptionsWrapper.prototype.getSelectionChanged = function() {
    return this.gridOptions.selectionChanged;
};
GridOptionsWrapper.prototype.getVirtualRowRemoved = function() {
    return this.gridOptions.virtualRowRemoved;
};
GridOptionsWrapper.prototype.getDatasource = function() {
    return this.gridOptions.datasource;
};

GridOptionsWrapper.prototype.setSelectedRows = function(newSelectedRows) {
    return this.gridOptions.selectedRows = newSelectedRows;
};
GridOptionsWrapper.prototype.setSelectedNodesById = function(newSelectedNodes) {
    return this.gridOptions.selectedNodesById = newSelectedNodes;
};

GridOptionsWrapper.prototype.getIcons = function() {
    return this.gridOptions.icons;
};

GridOptionsWrapper.prototype.isDoInternalGrouping = function() {
    return !this.isRowsAlreadyGrouped() && this.gridOptions.groupKeys;
};

GridOptionsWrapper.prototype.isGroupCheckboxSelection = function() {
    return this.isGroupCheckboxSelectionChildren() || this.isGroupCheckboxSelectionGroup();
};

GridOptionsWrapper.prototype.getHeaderHeight = function() {
    if (typeof this.gridOptions.headerHeight === 'number') {
        // if header height provided, used it
        return this.gridOptions.headerHeight;
    } else {
        // otherwise return 25 if no grouping, 50 if grouping
        if (this.isGroupHeaders()) {
            return 50;
        } else {
            return 25;
        }
    }
};

GridOptionsWrapper.prototype.isColumDefsPresent = function() {
    return this.gridOptions.columnDefs && this.gridOptions.columnDefs.length != 0;
};

GridOptionsWrapper.prototype.setupDefaults = function() {
    if (!this.gridOptions.rowHeight) {
        this.gridOptions.rowHeight = DEFAULT_ROW_HEIGHT;
    }
};

GridOptionsWrapper.prototype.getPinnedColCount = function() {
    // if not using scrolls, then pinned columns doesn't make
    // sense, so always return 0
    if (this.isDontUseScrolls()) {
        return 0;
    }
    if (this.gridOptions.pinnedColumnCount) {
        //in case user puts in a string, cast to number
        return Number(this.gridOptions.pinnedColumnCount);
    } else {
        return 0;
    }
};

module.exports = GridOptionsWrapper;

},{}],14:[function(require,module,exports){
function GroupCreator() {}

GroupCreator.prototype.group = function(rowNodes, groupByFields, groupAggFunction, expandByDefault) {

    var topMostGroup = {
        level: -1,
        children: [],
        childrenMap: {}
    };

    var allGroups = [];
    allGroups.push(topMostGroup);

    var levelToInsertChild = groupByFields.length - 1;
    var i, currentLevel, node, data, currentGroup, groupByField, groupKey, nextGroup;

    // start at -1 and go backwards, as all the positive indexes
    // are already used by the nodes.
    var index = -1;

    for (i = 0; i < rowNodes.length; i++) {
        node = rowNodes[i];
        data = node.data;

        for (currentLevel = 0; currentLevel < groupByFields.length; currentLevel++) {
            groupByField = groupByFields[currentLevel];
            groupKey = data[groupByField];

            if (currentLevel == 0) {
                currentGroup = topMostGroup;
            }

            //if group doesn't exist yet, create it
            nextGroup = currentGroup.childrenMap[groupKey];
            if (!nextGroup) {
                nextGroup = {
                    group: true,
                    field: groupByField,
                    id: index--,
                    key: groupKey,
                    expanded: this.isExpanded(expandByDefault, currentLevel),
                    children: [],
                    // for top most level, parent is null
                    parent: currentGroup === topMostGroup ? null : currentGroup,
                    allChildrenCount: 0,
                    level: currentGroup.level + 1,
                    childrenMap: {} //this is a temporary map, we remove at the end of this method
                };
                currentGroup.childrenMap[groupKey] = nextGroup;
                currentGroup.children.push(nextGroup);
                allGroups.push(nextGroup);
            }

            nextGroup.allChildrenCount++;

            if (currentLevel == levelToInsertChild) {
                node.parent = nextGroup === topMostGroup ? null : nextGroup;
                nextGroup.children.push(node);
            } else {
                currentGroup = nextGroup;
            }
        }

    }

    //remove the temporary map
    for (i = 0; i < allGroups.length; i++) {
        delete allGroups[i].childrenMap;
    }

    return topMostGroup.children;
};

GroupCreator.prototype.isExpanded = function(expandByDefault, level) {
    if (typeof expandByDefault === 'number') {
        return level < expandByDefault;
    } else {
        return expandByDefault === true || expandByDefault === 'true';
    }
};

module.exports = new GroupCreator();

},{}],15:[function(require,module,exports){
var utils = require('./utils');
var SvgFactory = require('./svgFactory');
var constants = require('./constants');

var svgFactory = new SvgFactory();

function HeaderRenderer() {}

HeaderRenderer.prototype.init = function(gridOptionsWrapper, columnController, columnModel, eGrid, angularGrid, filterManager, $scope, $compile) {
    this.gridOptionsWrapper = gridOptionsWrapper;
    this.columnModel = columnModel;
    this.columnController = columnController;
    this.angularGrid = angularGrid;
    this.filterManager = filterManager;
    this.$scope = $scope;
    this.$compile = $compile;
    this.findAllElements(eGrid);
};

HeaderRenderer.prototype.findAllElements = function(eGrid) {

    if (this.gridOptionsWrapper.isDontUseScrolls()) {
        this.eHeaderContainer = eGrid.querySelector(".ag-header-container");
        this.eRoot = eGrid.querySelector(".ag-root");
        // for no-scroll, all header cells live in the header container (the ag-header doesn't exist)
        this.eHeaderParent = this.eHeaderContainer;
    } else {
        this.ePinnedHeader = eGrid.querySelector(".ag-pinned-header");
        this.eHeaderContainer = eGrid.querySelector(".ag-header-container");
        this.eHeader = eGrid.querySelector(".ag-header");
        this.eRoot = eGrid.querySelector(".ag-root");
        // for scroll, all header cells live in the header (contains both normal and pinned headers)
        this.eHeaderParent = this.eHeader;
    }
};

HeaderRenderer.prototype.refreshHeader = function() {
    utils.removeAllChildren(this.ePinnedHeader);
    utils.removeAllChildren(this.eHeaderContainer);

    if (this.childScopes) {
        this.childScopes.forEach(function(childScope) {
            childScope.$destroy();
        });
    }
    this.childScopes = [];

    if (this.gridOptionsWrapper.isGroupHeaders()) {
        this.insertHeadersWithGrouping();
    } else {
        this.insertHeadersWithoutGrouping();
    }

};

HeaderRenderer.prototype.insertHeadersWithGrouping = function() {
    var groups = this.columnModel.getColumnGroups();
    var that = this;
    groups.forEach(function(group) {
        var eHeaderCell = that.createGroupedHeaderCell(group);
        var eContainerToAddTo = group.pinned ? that.ePinnedHeader : that.eHeaderContainer;
        eContainerToAddTo.appendChild(eHeaderCell);
    });
};

HeaderRenderer.prototype.createGroupedHeaderCell = function(group) {

    var eHeaderGroup = document.createElement('div');
    eHeaderGroup.className = 'ag-header-group';

    var eHeaderGroupCell = document.createElement('div');
    group.eHeaderGroupCell = eHeaderGroupCell;
    var classNames = ['ag-header-group-cell'];
    // having different classes below allows the style to not have a bottom border
    // on the group header, if no group is specified
    if (group.name) {
        classNames.push('ag-header-group-cell-with-group');
    } else {
        classNames.push('ag-header-group-cell-no-group');
    }
    eHeaderGroupCell.className = classNames.join(' ');

    if (this.gridOptionsWrapper.isEnableColResize()) {
        var eHeaderCellResize = document.createElement("div");
        eHeaderCellResize.className = "ag-header-cell-resize";
        eHeaderGroupCell.appendChild(eHeaderCellResize);
        group.eHeaderCellResize = eHeaderCellResize;
        var dragCallback = this.groupDragCallbackFactory(group);
        this.addDragHandler(eHeaderCellResize, dragCallback);
    }

    // no renderer, default text render
    var groupName = group.name;
    if (groupName && groupName !== '') {
        var eGroupCellLabel = document.createElement("div");
        eGroupCellLabel.className = 'ag-header-group-cell-label';
        eHeaderGroupCell.appendChild(eGroupCellLabel);

        var eInnerText = document.createElement("span");
        eInnerText.className = 'ag-header-group-text';
        eInnerText.innerHTML = groupName;
        eGroupCellLabel.appendChild(eInnerText);

        if (group.expandable) {
            this.addGroupExpandIcon(group, eGroupCellLabel, group.expanded);
        }
    }
    eHeaderGroup.appendChild(eHeaderGroupCell);

    var that = this;
    group.visibleColumns.forEach(function(column) {
        var eHeaderCell = that.createHeaderCell(column, true, group);
        eHeaderGroup.appendChild(eHeaderCell);
    });

    that.setWidthOfGroupHeaderCell(group);

    return eHeaderGroup;
};

HeaderRenderer.prototype.addGroupExpandIcon = function(group, eHeaderGroup, expanded) {
    var eGroupIcon;
    if (expanded) {
        eGroupIcon = utils.createIcon('columnGroupOpened', this.gridOptionsWrapper, null, svgFactory.createArrowLeftSvg);
    } else {
        eGroupIcon = utils.createIcon('columnGroupClosed', this.gridOptionsWrapper, null, svgFactory.createArrowRightSvg);
    }
    eGroupIcon.className = 'ag-header-expand-icon';
    eHeaderGroup.appendChild(eGroupIcon);

    var that = this;
    eGroupIcon.onclick = function() {
        that.columnController.columnGroupOpened(group);
    };
};

HeaderRenderer.prototype.addDragHandler = function(eDraggableElement, dragCallback) {
    var that = this;
    eDraggableElement.onmousedown = function(downEvent) {
        dragCallback.onDragStart();
        that.eRoot.style.cursor = "col-resize";
        that.dragStartX = downEvent.clientX;

        that.eRoot.onmousemove = function(moveEvent) {
            var newX = moveEvent.clientX;
            var change = newX - that.dragStartX;
            dragCallback.onDragging(change);
        };
        that.eRoot.onmouseup = function() {
            that.stopDragging();
        };
        that.eRoot.onmouseleave = function() {
            that.stopDragging();
        };
    };
};

HeaderRenderer.prototype.setWidthOfGroupHeaderCell = function(headerGroup) {
    var totalWidth = 0;
    headerGroup.visibleColumns.forEach(function(column) {
        totalWidth += column.actualWidth;
    });
    headerGroup.eHeaderGroupCell.style.width = utils.formatWidth(totalWidth);
    headerGroup.actualWidth = totalWidth;
};

HeaderRenderer.prototype.insertHeadersWithoutGrouping = function() {
    var ePinnedHeader = this.ePinnedHeader;
    var eHeaderContainer = this.eHeaderContainer;
    var that = this;

    this.columnModel.getVisibleColumns().forEach(function(column) {
        // only include the first x cols
        var headerCell = that.createHeaderCell(column, false);
        if (column.pinned) {
            ePinnedHeader.appendChild(headerCell);
        } else {
            eHeaderContainer.appendChild(headerCell);
        }
    });
};

HeaderRenderer.prototype.createHeaderCell = function(column, grouped, headerGroup) {
    var that = this;
    var colDef = column.colDef;
    var eHeaderCell = document.createElement("div");
    // stick the header cell in column, as we access it when group is re-sized
    column.eHeaderCell = eHeaderCell;

    var headerCellClasses = ['ag-header-cell'];
    if (grouped) {
        headerCellClasses.push('ag-header-cell-grouped'); // this takes 50% height
    } else {
        headerCellClasses.push('ag-header-cell-not-grouped'); // this takes 100% height
    }
    eHeaderCell.className = headerCellClasses.join(' ');

    // add tooltip if exists
    if (colDef.headerTooltip) {
        eHeaderCell.title = colDef.headerTooltip;
    }

    if (this.gridOptionsWrapper.isEnableColResize()) {
        var headerCellResize = document.createElement("div");
        headerCellResize.className = "ag-header-cell-resize";
        eHeaderCell.appendChild(headerCellResize);
        var dragCallback = this.headerDragCallbackFactory(eHeaderCell, column, headerGroup);
        this.addDragHandler(headerCellResize, dragCallback);
    }

    // filter button
    var showMenu = this.gridOptionsWrapper.isEnableFilter() && !colDef.suppressMenu;
    if (showMenu) {
        var eMenuButton = utils.createIcon('menu', this.gridOptionsWrapper, column, svgFactory.createMenuSvg);
        utils.addCssClass(eMenuButton, 'ag-header-icon');

        eMenuButton.setAttribute("class", "ag-header-cell-menu-button");
        eMenuButton.onclick = function() {
            that.filterManager.showFilter(column, this);
        };
        eHeaderCell.appendChild(eMenuButton);
        eHeaderCell.onmouseenter = function() {
            eMenuButton.style.opacity = 1;
        };
        eHeaderCell.onmouseleave = function() {
            eMenuButton.style.opacity = 0;
        };
        eMenuButton.style.opacity = 0;
        eMenuButton.style["-webkit-transition"] = "opacity 0.5s, border 0.2s";
        eMenuButton.style["transition"] = "opacity 0.5s, border 0.2s";
    }

    // label div
    var headerCellLabel = document.createElement("div");
    headerCellLabel.className = "ag-header-cell-label";

    // add in sort icons
    if (this.gridOptionsWrapper.isEnableSorting() && !colDef.suppressSorting) {
        column.eSortAsc = utils.createIcon('sortAscending', this.gridOptionsWrapper, column, svgFactory.createArrowUpSvg);
        column.eSortDesc = utils.createIcon('sortDescending', this.gridOptionsWrapper, column, svgFactory.createArrowDownSvg);
        utils.addCssClass(column.eSortAsc, 'ag-header-icon');
        utils.addCssClass(column.eSortDesc, 'ag-header-icon');
        headerCellLabel.appendChild(column.eSortAsc);
        headerCellLabel.appendChild(column.eSortDesc);
        column.eSortAsc.style.display = 'none';
        column.eSortDesc.style.display = 'none';
        this.addSortHandling(headerCellLabel, column);
    }

    // add in filter icon
    column.eFilterIcon = utils.createIcon('filter', this.gridOptionsWrapper, column, svgFactory.createFilterSvg);
    utils.addCssClass(column.eFilterIcon, 'ag-header-icon');
    headerCellLabel.appendChild(column.eFilterIcon);

    // render the cell, use a renderer if one is provided
    var headerCellRenderer;
    if (colDef.headerCellRenderer) { // first look for a renderer in col def
        headerCellRenderer = colDef.headerCellRenderer;
    } else if (this.gridOptionsWrapper.getHeaderCellRenderer()) { // second look for one in grid options
        headerCellRenderer = this.gridOptionsWrapper.getHeaderCellRenderer();
    }
    if (headerCellRenderer) {
        // renderer provided, use it
        var newChildScope;
        if (this.gridOptionsWrapper.isAngularCompileHeaders()) {
            newChildScope = this.$scope.$new();
        }
        var cellRendererParams = {
            colDef: colDef,
            $scope: newChildScope,
            context: this.gridOptionsWrapper.getContext(),
            gridOptions: this.gridOptionsWrapper.getGridOptions()
        };
        var cellRendererResult = headerCellRenderer(cellRendererParams);
        var childToAppend;
        if (utils.isNode(cellRendererResult) || utils.isElement(cellRendererResult)) {
            // a dom node or element was returned, so add child
            childToAppend = cellRendererResult;
        } else {
            // otherwise assume it was html, so just insert
            var eTextSpan = document.createElement("span");
            eTextSpan.innerHTML = cellRendererResult;
            childToAppend = eTextSpan;
        }
        // angular compile header if option is turned on
        if (this.gridOptionsWrapper.isAngularCompileHeaders()) {
            newChildScope.colDef = colDef;
            newChildScope.colIndex = colDef.index;
            newChildScope.colDefWrapper = column;
            this.childScopes.push(newChildScope);
            var childToAppendCompiled = this.$compile(childToAppend)(newChildScope)[0];
            headerCellLabel.appendChild(childToAppendCompiled);
        } else {
            headerCellLabel.appendChild(childToAppend);
        }
    } else {
        // no renderer, default text render
        var eInnerText = document.createElement("span");
        eInnerText.className = 'ag-header-cell-text';
        eInnerText.innerHTML = colDef.displayName;
        headerCellLabel.appendChild(eInnerText);
    }

    eHeaderCell.appendChild(headerCellLabel);
    eHeaderCell.style.width = utils.formatWidth(column.actualWidth);

    return eHeaderCell;
};

HeaderRenderer.prototype.addSortHandling = function(headerCellLabel, colDefWrapper) {
    var that = this;

    headerCellLabel.addEventListener("click", function() {

        // update sort on current col
        if (colDefWrapper.sort === constants.ASC) {
            colDefWrapper.sort = constants.DESC;
        } else if (colDefWrapper.sort === constants.DESC) {
            colDefWrapper.sort = null
        } else {
            colDefWrapper.sort = constants.ASC;
        }

        // clear sort on all columns except this one, and update the icons
        that.columnModel.getAllColumns().forEach(function(columnToClear) {
            if (columnToClear !== colDefWrapper) {
                columnToClear.sort = null;
            }

            // check in case no sorting on this particular col, as sorting is optional per col
            if (columnToClear.colDef.suppressSorting) {
                return;
            }

            // update visibility of icons
            var sortAscending = columnToClear.sort === constants.ASC;
            var sortDescending = columnToClear.sort === constants.DESC;

            if (columnToClear.eSortAsc) {
                columnToClear.eSortAsc.style.display = sortAscending ? 'inline' : 'none';
            }
            if (columnToClear.eSortDesc) {
                columnToClear.eSortDesc.style.display = sortDescending ? 'inline' : 'none';
            }
        });

        that.angularGrid.updateModelAndRefresh(constants.STEP_SORT);
    });
};

HeaderRenderer.prototype.groupDragCallbackFactory = function(currentGroup) {
    var parent = this;
    var visibleColumns = currentGroup.visibleColumns;
    return {
        onDragStart: function() {
            this.groupWidthStart = currentGroup.actualWidth;
            this.childrenWidthStarts = [];
            var that = this;
            visibleColumns.forEach(function(colDefWrapper) {
                that.childrenWidthStarts.push(colDefWrapper.actualWidth);
            });
            this.minWidth = visibleColumns.length * constants.MIN_COL_WIDTH;
        },
        onDragging: function(dragChange) {

            var newWidth = this.groupWidthStart + dragChange;
            if (newWidth < this.minWidth) {
                newWidth = this.minWidth;
            }

            // set the new width to the group header
            var newWidthPx = newWidth + "px";
            currentGroup.eHeaderGroupCell.style.width = newWidthPx;
            currentGroup.actualWidth = newWidth;

            // distribute the new width to the child headers
            var changeRatio = newWidth / this.groupWidthStart;
            // keep track of pixels used, and last column gets the remaining,
            // to cater for rounding errors, and min width adjustments
            var pixelsToDistribute = newWidth;
            var that = this;
            currentGroup.visibleColumns.forEach(function(colDefWrapper, index) {
                var notLastCol = index !== (visibleColumns.length - 1);
                var newChildSize;
                if (notLastCol) {
                    // if not the last col, calculate the column width as normal
                    var startChildSize = that.childrenWidthStarts[index];
                    newChildSize = startChildSize * changeRatio;
                    if (newChildSize < constants.MIN_COL_WIDTH) {
                        newChildSize = constants.MIN_COL_WIDTH;
                    }
                    pixelsToDistribute -= newChildSize;
                } else {
                    // if last col, give it the remaining pixels
                    newChildSize = pixelsToDistribute;
                }
                var eHeaderCell = visibleColumns[index].eHeaderCell;
                parent.adjustColumnWidth(newChildSize, colDefWrapper, eHeaderCell);
            });

            // should not be calling these here, should do something else
            if (currentGroup.pinned) {
                parent.angularGrid.updatePinnedColContainerWidthAfterColResize();
            } else {
                parent.angularGrid.updateBodyContainerWidthAfterColResize();
            }
        }
    };
};

HeaderRenderer.prototype.adjustColumnWidth = function(newWidth, column, eHeaderCell) {
    var newWidthPx = newWidth + "px";
    var selectorForAllColsInCell = ".cell-col-" + column.index;
    var cellsForThisCol = this.eRoot.querySelectorAll(selectorForAllColsInCell);
    for (var i = 0; i < cellsForThisCol.length; i++) {
        cellsForThisCol[i].style.width = newWidthPx;
    }

    eHeaderCell.style.width = newWidthPx;
    column.actualWidth = newWidth;
};

// gets called when a header (not a header group) gets resized
HeaderRenderer.prototype.headerDragCallbackFactory = function(headerCell, column, headerGroup) {
    var parent = this;
    return {
        onDragStart: function() {
            this.startWidth = column.actualWidth;
        },
        onDragging: function(dragChange) {
            var newWidth = this.startWidth + dragChange;
            if (newWidth < constants.MIN_COL_WIDTH) {
                newWidth = constants.MIN_COL_WIDTH;
            }

            parent.adjustColumnWidth(newWidth, column, headerCell);

            if (headerGroup) {
                parent.setWidthOfGroupHeaderCell(headerGroup);
            }

            // should not be calling these here, should do something else
            if (column.pinned) {
                parent.angularGrid.updatePinnedColContainerWidthAfterColResize();
            } else {
                parent.angularGrid.updateBodyContainerWidthAfterColResize();
            }
        }
    };
};

HeaderRenderer.prototype.stopDragging = function() {
    this.eRoot.style.cursor = "";
    this.eRoot.onmouseup = null;
    this.eRoot.onmouseleave = null;
    this.eRoot.onmousemove = null;
};

HeaderRenderer.prototype.updateFilterIcons = function() {
    var that = this;
    this.columnModel.getVisibleColumns().forEach(function(column) {
        // todo: need to change this, so only updates if column is visible
        if (column.eFilterIcon) {
            var filterPresent = that.filterManager.isFilterPresentForCol(column.colKey);
            var displayStyle = filterPresent ? 'inline' : 'none';
            column.eFilterIcon.style.display = displayStyle;
        }
    });
};

module.exports = HeaderRenderer;

},{"./constants":3,"./svgFactory":21,"./utils":24}],16:[function(require,module,exports){
var groupCreator = require('./groupCreator');
var utils = require('./utils');
var constants = require('./constants');

function InMemoryRowController() {
    this.createModel();
}

InMemoryRowController.prototype.init = function(gridOptionsWrapper, columnModel, angularGrid, filterManager, $scope) {
    this.gridOptionsWrapper = gridOptionsWrapper;
    this.columnModel = columnModel;
    this.angularGrid = angularGrid;
    this.filterManager = filterManager;
    this.$scope = $scope;

    this.allRows = null;
    this.rowsAfterGroup = null;
    this.rowsAfterFilter = null;
    this.rowsAfterSort = null;
    this.rowsAfterMap = null;
};

// private
InMemoryRowController.prototype.createModel = function() {
    var that = this;
    this.model = {
        // this method is implemented by the inMemory model only,
        // it gives the top level of the selection. used by the selection
        // controller, when it needs to do a full traversal
        getTopLevelNodes: function() {
            return that.rowsAfterGroup;
        },
        getVirtualRow: function(index) {
            return that.rowsAfterMap[index];
        },
        getVirtualRowCount: function() {
            if (that.rowsAfterMap) {
                return that.rowsAfterMap.length;
            } else {
                return 0;
            }
        }
    };
};

// public
InMemoryRowController.prototype.getModel = function() {
    return this.model;
};

// public
InMemoryRowController.prototype.updateModel = function(step) {

    // fallthrough in below switch is on purpose
    switch (step) {
        case constants.STEP_EVERYTHING:
            this.doGrouping();
        case constants.STEP_FILTER:
            this.doFilter();
            this.doAggregate();
        case constants.STEP_SORT:
            this.doSort();
        case constants.STEP_MAP:
            this.doGroupMapping();
    }

    if (typeof this.gridOptionsWrapper.getModelUpdated() === 'function') {
        this.gridOptionsWrapper.getModelUpdated()();
        var $scope = this.$scope;
        if ($scope) {
            setTimeout(function() {
                $scope.$apply();
            }, 0);
        }
    }

};

// public - it's possible to recompute the aggregate without doing the other parts
InMemoryRowController.prototype.doAggregate = function() {

    var groupAggFunction = this.gridOptionsWrapper.getGroupAggFunction();
    if (typeof groupAggFunction !== 'function') {
        return;
    }

    this.recursivelyCreateAggData(this.rowsAfterFilter, groupAggFunction);
};

// public
InMemoryRowController.prototype.expandOrCollapseAll = function(expand, rowNodes) {
    // if first call in recursion, we set list to parent list
    if (rowNodes === null) {
        rowNodes = this.rowsAfterGroup;
    }

    if (!rowNodes) {
        return;
    }

    var _this = this;
    rowNodes.forEach(function(node) {
        if (node.group) {
            node.expanded = expand;
            _this.expandOrCollapseAll(expand, node.children);
        }
    });
};

// private
InMemoryRowController.prototype.recursivelyCreateAggData = function(nodes, groupAggFunction) {
    for (var i = 0, l = nodes.length; i < l; i++) {
        var node = nodes[i];
        if (node.group) {
            // agg function needs to start at the bottom, so traverse first
            this.recursivelyCreateAggData(node.children, groupAggFunction);
            // after traversal, we can now do the agg at this level
            var data = groupAggFunction(node.children);
            node.data = data;
            // if we are grouping, then it's possible there is a sibling footer
            // to the group, so update the data here also if thers is one
            if (node.sibling) {
                node.sibling.data = data;
            }
        }
    }
};

// private
InMemoryRowController.prototype.doSort = function() {
    //see if there is a col we are sorting by
    var columnForSorting = null;
    this.columnModel.getAllColumns().forEach(function(colDefWrapper) {
        if (colDefWrapper.sort) {
            columnForSorting = colDefWrapper;
        }
    });

    var rowNodesBeforeSort = this.rowsAfterFilter.slice(0);

    if (columnForSorting) {
        var ascending = columnForSorting.sort === constants.ASC;
        var inverter = ascending ? 1 : -1;

        this.sortList(rowNodesBeforeSort, columnForSorting.colDef, inverter);
    } else {
        //if no sorting, set all group children after sort to the original list
        this.resetSortInGroups(rowNodesBeforeSort);
    }

    this.rowsAfterSort = rowNodesBeforeSort;
};

// private
InMemoryRowController.prototype.resetSortInGroups = function(rowNodes) {
    for (var i = 0, l = rowNodes.length; i < l; i++) {
        var item = rowNodes[i];
        if (item.group && item.children) {
            item.childrenAfterSort = item.children;
            this.resetSortInGroups(item.children);
        }
    }
};

// private
InMemoryRowController.prototype.sortList = function(nodes, columnForSorting, inverter) {

    // sort any groups recursively
    for (var i = 0, l = nodes.length; i < l; i++) { // critical section, no functional programming
        var node = nodes[i];
        if (node.group && node.children) {
            node.childrenAfterSort = node.children.slice(0);
            this.sortList(node.childrenAfterSort, columnForSorting, inverter);
        }
    }

    nodes.sort(function(objA, objB) {
        var keyForSort = columnForSorting.field;
        var valueA = objA.data ? objA.data[keyForSort] : null;
        var valueB = objB.data ? objB.data[keyForSort] : null;

        if (columnForSorting.comparator) {
            //if comparator provided, use it
            return columnForSorting.comparator(valueA, valueB) * inverter;
        } else {
            //otherwise do our own comparison
            return utils.defaultComparator(valueA, valueB) * inverter;
        }

    });
};

// private
InMemoryRowController.prototype.doGrouping = function() {
    var rowsAfterGroup;
    if (this.gridOptionsWrapper.isDoInternalGrouping()) {
        var expandByDefault = this.gridOptionsWrapper.getGroupDefaultExpanded();
        rowsAfterGroup = groupCreator.group(this.allRows, this.gridOptionsWrapper.getGroupKeys(),
            this.gridOptionsWrapper.getGroupAggFunction(), expandByDefault);
    } else {
        rowsAfterGroup = this.allRows;
    }
    this.rowsAfterGroup = rowsAfterGroup;
};

// private
InMemoryRowController.prototype.doFilter = function() {
    var quickFilterPresent = this.angularGrid.getQuickFilter() !== null;
    var advancedFilterPresent = this.filterManager.isFilterPresent();
    var filterPresent = quickFilterPresent || advancedFilterPresent;

    var rowsAfterFilter;
    if (filterPresent) {
        rowsAfterFilter = this.filterItems(this.rowsAfterGroup, quickFilterPresent, advancedFilterPresent);
    } else {
        rowsAfterFilter = this.rowsAfterGroup;
    }
    this.rowsAfterFilter = rowsAfterFilter;
};

// private
InMemoryRowController.prototype.filterItems = function(rowNodes, quickFilterPresent, advancedFilterPresent) {
    var result = [];

    for (var i = 0, l = rowNodes.length; i < l; i++) {
        var node = rowNodes[i];

        if (node.group) {
            // deal with group
            var filteredChildren = this.filterItems(node.children, quickFilterPresent, advancedFilterPresent);
            if (filteredChildren.length > 0) {
                var allChildrenCount = this.getTotalChildCount(filteredChildren);
                var newGroup = this.copyGroupNode(node, filteredChildren, allChildrenCount);

                result.push(newGroup);
            }
        } else {
            if (this.doesRowPassFilter(node, quickFilterPresent, advancedFilterPresent)) {
                result.push(node);
            }
        }
    }

    return result;
};

// private
// rows: the rows to put into the model
// firstId: the first id to use, used for paging, where we are not on the first page
InMemoryRowController.prototype.setAllRows = function(rows, firstId) {
    var nodes;
    if (this.gridOptionsWrapper.isRowsAlreadyGrouped()) {
        nodes = rows;
        this.recursivelyCheckUserProvidedNodes(nodes, null, 0);
    } else {
        // place each row into a wrapper
        var nodes = [];
        if (rows) {
            for (var i = 0; i < rows.length; i++) { // could be lots of rows, don't use functional programming
                nodes.push({
                    data: rows[i]
                });
            }
        }
    }

    // if firstId provided, use it, otherwise start at 0
    var firstIdToUse = firstId ? firstId : 0;
    this.recursivelyAddIdToNodes(nodes, firstIdToUse);
    this.allRows = nodes;
};

// add in index - this is used by the selectionController - so quick
// to look up selected rows
InMemoryRowController.prototype.recursivelyAddIdToNodes = function(nodes, index) {
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        node.id = index++;
        if (node.group && node.children) {
            index = this.recursivelyAddIdToNodes(node.children, index);
        }
    }
    return index;
};

// add in index - this is used by the selectionController - so quick
// to look up selected rows
InMemoryRowController.prototype.recursivelyCheckUserProvidedNodes = function(nodes, parent, level) {
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (parent) {
            node.parent = parent;
        }
        node.level = level;
        if (node.group && node.children) {
            this.recursivelyCheckUserProvidedNodes(node.children, node, level + 1);
        }
    }
};

// private
InMemoryRowController.prototype.getTotalChildCount = function(rowNodes) {
    var count = 0;
    for (var i = 0, l = rowNodes.length; i < l; i++) {
        var item = rowNodes[i];
        if (item.group) {
            count += item.allChildrenCount;
        } else {
            count++;
        }
    }
    return count;
};

// private
InMemoryRowController.prototype.copyGroupNode = function(groupNode, children, allChildrenCount) {
    return {
        group: true,
        data: groupNode.data,
        field: groupNode.field,
        key: groupNode.key,
        expanded: groupNode.expanded,
        children: children,
        allChildrenCount: allChildrenCount,
        level: groupNode.level
    };
};

// private
InMemoryRowController.prototype.doGroupMapping = function() {
    // even if not going grouping, we do the mapping, as the client might
    // of passed in data that already has a grouping in it somewhere
    var rowsAfterMap = [];
    this.addToMap(rowsAfterMap, this.rowsAfterSort);
    this.rowsAfterMap = rowsAfterMap;
};

// private
InMemoryRowController.prototype.addToMap = function(mappedData, originalNodes) {
    if (!originalNodes) {
        return;
    }
    for (var i = 0; i < originalNodes.length; i++) {
        var node = originalNodes[i];
        mappedData.push(node);
        if (node.group && node.expanded) {
            this.addToMap(mappedData, node.childrenAfterSort);

            // put a footer in if user is looking for it
            if (this.gridOptionsWrapper.isGroupIncludeFooter()) {
                var footerNode = this.createFooterNode(node);
                mappedData.push(footerNode);
            }
        }
    }
};

// private
InMemoryRowController.prototype.createFooterNode = function(groupNode) {
    var footerNode = {};
    Object.keys(groupNode).forEach(function(key) {
        footerNode[key] = groupNode[key];
    });
    footerNode.footer = true;
    // get both header and footer to reference each other as siblings. this is never undone,
    // only overwritten. so if a group is expanded, then contracted, it will have a ghost
    // sibling - but that's fine, as we can ignore this if the header is contracted.
    footerNode.sibling = groupNode;
    groupNode.sibling = footerNode;
    return footerNode;
};

// private
InMemoryRowController.prototype.doesRowPassFilter = function(node, quickFilterPresent, advancedFilterPresent) {
    //first up, check quick filter
    if (quickFilterPresent) {
        if (!node.quickFilterAggregateText) {
            this.aggregateRowForQuickFilter(node);
        }
        if (node.quickFilterAggregateText.indexOf(this.angularGrid.getQuickFilter()) < 0) {
            //quick filter fails, so skip item
            return false;
        }
    }

    //second, check advanced filter
    if (advancedFilterPresent) {
        if (!this.filterManager.doesFilterPass(node)) {
            return false;
        }
    }

    //got this far, all filters pass
    return true;
};

// private
InMemoryRowController.prototype.aggregateRowForQuickFilter = function(node) {
    var aggregatedText = '';
    this.columnModel.getAllColumns().forEach(function(colDefWrapper) {
        var data = node.data;
        var value = data ? data[colDefWrapper.colDef.field] : null;
        if (value && value !== '') {
            aggregatedText = aggregatedText + value.toString().toUpperCase() + "_";
        }
    });
    node.quickFilterAggregateText = aggregatedText;
};

module.exports = InMemoryRowController;

},{"./constants":3,"./groupCreator":14,"./utils":24}],17:[function(require,module,exports){
var TEMPLATE = [
    '<span id="pageRowSummaryPanel" class="ag-paging-row-summary-panel">',
    '<span id="firstRowOnPage"></span>',
    ' to ',
    '<span id="lastRowOnPage"></span>',
    ' of ',
    '<span id="recordCount"></span>',
    '</span>',
    '<span clas="ag-paging-page-summary-panel">',
    '<button class="ag-paging-button" id="btFirst">First</button>',
    '<button class="ag-paging-button" id="btPrevious">Previous</button>',
    ' Page ',
    '<span id="current"></span>',
    ' of ',
    '<span id="total"></span>',
    '<button class="ag-paging-button" id="btNext">Next</button>',
    '<button class="ag-paging-button" id="btLast">Last</button>',
    '</span>'
].join('');

function PaginationController() {}

PaginationController.prototype.init = function(ePagingPanel, angularGrid) {
    this.angularGrid = angularGrid;
    this.populatePanel(ePagingPanel);
    this.callVersion = 0;
};

PaginationController.prototype.setDatasource = function(datasource) {
    this.datasource = datasource;

    if (!datasource) {
        // only continue if we have a valid datasource to work with
        return;
    }

    this.reset();
};

PaginationController.prototype.reset = function() {
    // copy pageSize, to guard against it changing the the datasource between calls
    this.pageSize = this.datasource.pageSize;
    // see if we know the total number of pages, or if it's 'to be decided'
    if (this.datasource.rowCount >= 0) {
        this.rowCount = this.datasource.rowCount;
        this.foundMaxRow = true;
        this.calculateTotalPages();
    } else {
        this.rowCount = 0;
        this.foundMaxRow = false;
        this.totalPages = null;
    }

    this.currentPage = 0;

    // hide the summary panel until something is loaded
    this.ePageRowSummaryPanel.style.visibility = 'hidden';

    this.setTotalLabels();
    this.loadPage();
};

PaginationController.prototype.setTotalLabels = function() {
    if (this.foundMaxRow) {
        this.lbTotal.innerHTML = this.totalPages.toLocaleString();
        this.lbRecordCount.innerHTML = this.rowCount.toLocaleString();
    } else {
        this.lbTotal.innerHTML = 'more';
        this.lbRecordCount.innerHTML = 'more';
    }
};

PaginationController.prototype.calculateTotalPages = function() {
    this.totalPages = Math.floor((this.rowCount - 1) / this.pageSize) + 1;
};

PaginationController.prototype.pageLoaded = function(rows, lastRowIndex) {
    var firstId = this.currentPage * this.pageSize;
    this.angularGrid.setRows(rows, firstId);
    // see if we hit the last row
    if (!this.foundMaxRow && typeof lastRowIndex === 'number' && lastRowIndex >= 0) {
        this.foundMaxRow = true;
        this.rowCount = lastRowIndex;
        this.calculateTotalPages();
        this.setTotalLabels();

        // if overshot pages, go back
        if (this.currentPage > this.totalPages) {
            this.currentPage = this.totalPages - 1;
            this.loadPage();
        }
    }
    this.enableOrDisableButtons();
    this.updateRowLabels();
};

PaginationController.prototype.updateRowLabels = function() {
    var startRow = (this.pageSize * this.currentPage) + 1;
    var endRow = startRow + this.pageSize - 1;
    if (this.foundMaxRow && endRow > this.rowCount) {
        endRow = this.rowCount;
    }
    this.lbFirstRowOnPage.innerHTML = (startRow).toLocaleString();
    this.lbLastRowOnPage.innerHTML = (endRow).toLocaleString();

    // show the summary panel, when first shown, this is blank
    this.ePageRowSummaryPanel.style.visibility = null;
};

PaginationController.prototype.loadPage = function() {
    this.enableOrDisableButtons();
    var startRow = this.currentPage * this.datasource.pageSize;
    var endRow = (this.currentPage + 1) * this.datasource.pageSize;

    this.lbCurrent.innerHTML = (this.currentPage + 1).toLocaleString();

    this.callVersion++;
    var callVersionCopy = this.callVersion;
    var that = this;
    this.angularGrid.showLoadingPanel(true);
    this.datasource.getRows(startRow, endRow,
        function success(rows, lastRowIndex) {
            if (that.isCallDaemon(callVersionCopy)) {
                return;
            }
            that.pageLoaded(rows, lastRowIndex);
        },
        function fail() {
            if (that.isCallDaemon(callVersionCopy)) {
                return;
            }
            // set in an empty set of rows, this will at
            // least get rid of the loading panel, and
            // stop blocking things
            that.angularGrid.setRows([]);
        }
    );
};

PaginationController.prototype.isCallDaemon = function(versionCopy) {
    return versionCopy !== this.callVersion;
};

PaginationController.prototype.onBtNext = function() {
    this.currentPage++;
    this.loadPage();
};

PaginationController.prototype.onBtPrevious = function() {
    this.currentPage--;
    this.loadPage();
};

PaginationController.prototype.onBtFirst = function() {
    this.currentPage = 0;
    this.loadPage();
};

PaginationController.prototype.onBtLast = function() {
    this.currentPage = this.totalPages - 1;
    this.loadPage();
};

PaginationController.prototype.enableOrDisableButtons = function() {
    var disablePreviousAndFirst = this.currentPage === 0;
    this.btPrevious.disabled = disablePreviousAndFirst;
    this.btFirst.disabled = disablePreviousAndFirst;

    var disableNext = this.foundMaxRow && this.currentPage === (this.totalPages - 1);
    this.btNext.disabled = disableNext;

    var disableLast = !this.foundMaxRow || this.currentPage === (this.totalPages - 1);
    this.btLast.disabled = disableLast;
};

PaginationController.prototype.populatePanel = function(ePagingPanel) {

    ePagingPanel.innerHTML = TEMPLATE;

    this.btNext = ePagingPanel.querySelector('#btNext');
    this.btPrevious = ePagingPanel.querySelector('#btPrevious');
    this.btFirst = ePagingPanel.querySelector('#btFirst');
    this.btLast = ePagingPanel.querySelector('#btLast');
    this.lbCurrent = ePagingPanel.querySelector('#current');
    this.lbTotal = ePagingPanel.querySelector('#total');

    this.lbRecordCount = ePagingPanel.querySelector('#recordCount');
    this.lbFirstRowOnPage = ePagingPanel.querySelector('#firstRowOnPage');
    this.lbLastRowOnPage = ePagingPanel.querySelector('#lastRowOnPage');
    this.ePageRowSummaryPanel = ePagingPanel.querySelector('#pageRowSummaryPanel');

    var that = this;

    this.btNext.addEventListener('click', function() {
        that.onBtNext();
    });

    this.btPrevious.addEventListener('click', function() {
        that.onBtPrevious();
    });

    this.btFirst.addEventListener('click', function() {
        that.onBtFirst();
    });

    this.btLast.addEventListener('click', function() {
        that.onBtLast();
    });
};

module.exports = PaginationController;

},{}],18:[function(require,module,exports){
var constants = require('./constants');
var SvgFactory = require('./svgFactory');
var utils = require('./utils');

var svgFactory = new SvgFactory();

var TAB_KEY = 9;
var ENTER_KEY = 13;

function RowRenderer() {}

RowRenderer.prototype.init = function(gridOptions, columnModel, gridOptionsWrapper, eGrid,
    angularGrid, selectionRendererFactory, $compile, $scope,
    selectionController) {
    this.gridOptions = gridOptions;
    this.columnModel = columnModel;
    this.gridOptionsWrapper = gridOptionsWrapper;
    this.angularGrid = angularGrid;
    this.selectionRendererFactory = selectionRendererFactory;
    this.findAllElements(eGrid);
    this.$compile = $compile;
    this.$scope = $scope;
    this.selectionController = selectionController;

    // map of row ids to row objects. keeps track of which elements
    // are rendered for which rows in the dom. each row object has:
    // [scope, bodyRow, pinnedRow, rowData]
    this.renderedRows = {};

    this.renderedRowStartEditingListeners = {};

    this.editingCell = false; //gets set to true when editing a cell
};

RowRenderer.prototype.setRowModel = function(rowModel) {
    this.rowModel = rowModel;
};

RowRenderer.prototype.setMainRowWidths = function() {
    var mainRowWidth = this.columnModel.getBodyContainerWidth() + "px";

    var unpinnedRows = this.eBodyContainer.querySelectorAll(".ag-row");
    for (var i = 0; i < unpinnedRows.length; i++) {
        unpinnedRows[i].style.width = mainRowWidth;
    }
};

RowRenderer.prototype.findAllElements = function(eGrid) {
    if (this.gridOptionsWrapper.isDontUseScrolls()) {
        this.eBodyContainer = eGrid.querySelector(".ag-body-container");
    } else {
        this.eBodyContainer = eGrid.querySelector(".ag-body-container");
        this.eBodyViewport = eGrid.querySelector(".ag-body-viewport");
        this.ePinnedColsContainer = eGrid.querySelector(".ag-pinned-cols-container");
    }
};

RowRenderer.prototype.refreshView = function() {
    if (!this.gridOptionsWrapper.isDontUseScrolls()) {
        var rowCount = this.rowModel.getVirtualRowCount();
        var containerHeight = this.gridOptionsWrapper.getRowHeight() * rowCount;
        this.eBodyContainer.style.height = containerHeight + "px";
        this.ePinnedColsContainer.style.height = containerHeight + "px";
    }

    this.refreshAllVirtualRows();
};

RowRenderer.prototype.rowDataChanged = function(rows) {
    // we only need to be worried about rendered rows, as this method is
    // called to whats rendered. if the row isn't rendered, we don't care
    var indexesToRemove = [];
    var renderedRows = this.renderedRows;
    Object.keys(renderedRows).forEach(function(key) {
        var renderedRow = renderedRows[key];
        // see if the rendered row is in the list of rows we have to update
        var rowNeedsUpdating = rows.indexOf(renderedRow.node.data) >= 0;
        if (rowNeedsUpdating) {
            indexesToRemove.push(key);
        }
    });
    // remove the rows
    this.removeVirtualRows(indexesToRemove);
    // add draw them again
    this.drawVirtualRows();
};

RowRenderer.prototype.refreshAllVirtualRows = function() {
    // remove all current virtual rows, as they have old data
    var rowsToRemove = Object.keys(this.renderedRows);
    this.removeVirtualRows(rowsToRemove);

    // add in new rows
    this.drawVirtualRows();
};

// public - removes the group rows and then redraws them again
RowRenderer.prototype.refreshGroupRows = function() {
    // find all the group rows
    var rowsToRemove = [];
    var that = this;
    Object.keys(this.renderedRows).forEach(function(key) {
        var renderedRow = that.renderedRows[key];
        var node = renderedRow.node;
        if (node.group) {
            rowsToRemove.push(key);
        }
    });
    // remove the rows
    this.removeVirtualRows(rowsToRemove);
    // and draw them back again
    this.ensureRowsRendered();
};

// takes array of row indexes
RowRenderer.prototype.removeVirtualRows = function(rowsToRemove) {
    var that = this;
    rowsToRemove.forEach(function(indexToRemove) {
        that.removeVirtualRow(indexToRemove);
    });
};

RowRenderer.prototype.removeVirtualRow = function(indexToRemove) {
    var renderedRow = this.renderedRows[indexToRemove];
    if (renderedRow.pinnedElement && this.ePinnedColsContainer) {
        this.ePinnedColsContainer.removeChild(renderedRow.pinnedElement);
    }

    if (renderedRow.bodyElement) {
        this.eBodyContainer.removeChild(renderedRow.bodyElement);
    }

    if (renderedRow.scope) {
        renderedRow.scope.$destroy();
    }

    if (this.gridOptionsWrapper.getVirtualRowRemoved()) {
        this.gridOptionsWrapper.getVirtualRowRemoved()(renderedRow.data, indexToRemove);
    }
    this.angularGrid.onVirtualRowRemoved(indexToRemove);

    delete this.renderedRows[indexToRemove];
    delete this.renderedRowStartEditingListeners[indexToRemove];
};

RowRenderer.prototype.drawVirtualRows = function() {
    var first;
    var last;

    var rowCount = this.rowModel.getVirtualRowCount();

    if (this.gridOptionsWrapper.isDontUseScrolls()) {
        first = 0;
        last = rowCount;
    } else {
        var topPixel = this.eBodyViewport.scrollTop;
        var bottomPixel = topPixel + this.eBodyViewport.offsetHeight;

        first = Math.floor(topPixel / this.gridOptionsWrapper.getRowHeight());
        last = Math.floor(bottomPixel / this.gridOptionsWrapper.getRowHeight());

        //add in buffer
        first = first - constants.ROW_BUFFER_SIZE;
        last = last + constants.ROW_BUFFER_SIZE;

        // adjust, in case buffer extended actual size
        if (first < 0) {
            first = 0;
        }
        if (last > rowCount - 1) {
            last = rowCount - 1;
        }
    }

    this.firstVirtualRenderedRow = first;
    this.lastVirtualRenderedRow = last;

    this.ensureRowsRendered();
};

RowRenderer.prototype.isIndexRendered = function(index) {
    return index >= this.firstVirtualRenderedRow && index <= this.lastVirtualRenderedRow;
};

RowRenderer.prototype.getFirstVirtualRenderedRow = function() {
    return this.firstVirtualRenderedRow;
};

RowRenderer.prototype.getLastVirtualRenderedRow = function() {
    return this.lastVirtualRenderedRow;
};

RowRenderer.prototype.ensureRowsRendered = function() {

    var mainRowWidth = this.columnModel.getBodyContainerWidth();
    var that = this;

    //at the end, this array will contain the items we need to remove
    var rowsToRemove = Object.keys(this.renderedRows);

    //add in new rows
    for (var rowIndex = this.firstVirtualRenderedRow; rowIndex <= this.lastVirtualRenderedRow; rowIndex++) {
        // see if item already there, and if yes, take it out of the 'to remove' array
        if (rowsToRemove.indexOf(rowIndex.toString()) >= 0) {
            rowsToRemove.splice(rowsToRemove.indexOf(rowIndex.toString()), 1);
            continue;
        }
        // check this row actually exists (in case overflow buffer window exceeds real data)
        var node = this.rowModel.getVirtualRow(rowIndex);
        if (node) {
            that.insertRow(node, rowIndex, mainRowWidth);
        }
    }

    //at this point, everything in our 'rowsToRemove' . . .
    this.removeVirtualRows(rowsToRemove);

    //if we are doing angular compiling, then do digest the scope here
    if (this.gridOptions.angularCompileRows) {
        // we do it in a timeout, in case we are already in an apply
        setTimeout(function() {
            that.$scope.$apply();
        }, 0);
    }
};

RowRenderer.prototype.insertRow = function(node, rowIndex, mainRowWidth) {
    //if no cols, don't draw row
    if (!this.gridOptionsWrapper.isColumDefsPresent()) {
        return;
    }

    //var rowData = node.rowData;
    var rowIsAGroup = node.group;
    var rowIsAFooter = node.footer;

    var ePinnedRow = this.createRowContainer(rowIndex, node, rowIsAGroup);
    var eMainRow = this.createRowContainer(rowIndex, node, rowIsAGroup);
    var _this = this;

    eMainRow.style.width = mainRowWidth + "px";

    // try compiling as we insert rows
    var newChildScope = this.createChildScopeOrNull(node.data);

    var renderedRow = {
        scope: newChildScope,
        node: node,
        rowIndex: rowIndex
    };
    this.renderedRows[rowIndex] = renderedRow;
    this.renderedRowStartEditingListeners[rowIndex] = {};

    // if group item, insert the first row
    var columns = this.columnModel.getVisibleColumns();
    if (rowIsAGroup) {
        var firstColumn = columns[0];
        var groupHeaderTakesEntireRow = this.gridOptionsWrapper.isGroupUseEntireRow();

        var eGroupRow = _this.createGroupElement(node, firstColumn, groupHeaderTakesEntireRow, false, rowIndex, rowIsAFooter);
        if (firstColumn.pinned) {
            ePinnedRow.appendChild(eGroupRow);
        } else {
            eMainRow.appendChild(eGroupRow);
        }

        if (firstColumn.pinned && groupHeaderTakesEntireRow) {
            var eGroupRowPadding = _this.createGroupElement(node, firstColumn, groupHeaderTakesEntireRow, true, rowIndex, rowIsAFooter);
            eMainRow.appendChild(eGroupRowPadding);
        }

        if (!groupHeaderTakesEntireRow) {

            // draw in cells for the rest of the row.
            // if group is a footer, always show the data.
            // if group is a header, only show data if not expanded
            var groupData;
            if (node.footer) {
                groupData = node.data;
            } else {
                // we show data in footer only
                var footersEnabled = this.gridOptionsWrapper.isGroupIncludeFooter();
                groupData = (node.expanded && footersEnabled) ? undefined : node.data;
            }
            columns.forEach(function(column, colIndex) {
                if (colIndex == 0) { //skip first col, as this is the group col we already inserted
                    return;
                }
                var value = groupData ? groupData[column.colDef.field] : undefined;
                _this.createCellFromColDef(false, column, value, node, rowIndex, eMainRow, ePinnedRow, newChildScope);
            });
        }

    } else {
        columns.forEach(function(column, index) {
            var firstCol = index === 0;
            _this.createCellFromColDef(firstCol, column, node.data[column.colDef.field], node, rowIndex, eMainRow, ePinnedRow, newChildScope);
        });
    }

    //try compiling as we insert rows
    renderedRow.pinnedElement = this.compileAndAdd(this.ePinnedColsContainer, rowIndex, ePinnedRow, newChildScope);
    renderedRow.bodyElement = this.compileAndAdd(this.eBodyContainer, rowIndex, eMainRow, newChildScope);
};

RowRenderer.prototype.createChildScopeOrNull = function(data) {
    if (this.gridOptionsWrapper.isAngularCompileRows()) {
        var newChildScope = this.$scope.$new();
        newChildScope.data = data;
        return newChildScope;
    } else {
        return null;
    }
};

RowRenderer.prototype.compileAndAdd = function(container, rowIndex, element, scope) {
    if (scope) {
        var eElementCompiled = this.$compile(element)(scope);
        if (container) { // checking container, as if noScroll, pinned container is missing
            container.appendChild(eElementCompiled[0]);
        }
        return eElementCompiled[0];
    } else {
        if (container) {
            container.appendChild(element);
        }
        return element;
    }
};

RowRenderer.prototype.createCellFromColDef = function(isFirstColumn, column, value, node, rowIndex, eMainRow, ePinnedRow, $childScope) {
    var eGridCell = this.createCell(isFirstColumn, column, value, node, rowIndex, $childScope);

    if (column.pinned) {
        ePinnedRow.appendChild(eGridCell);
    } else {
        eMainRow.appendChild(eGridCell);
    }
};

RowRenderer.prototype.addClassesToRow = function(rowIndex, node, eRow) {
    var classesList = ["ag-row"];
    classesList.push(rowIndex % 2 == 0 ? "ag-row-even" : "ag-row-odd");

    if (this.selectionController.isNodeSelected(node)) {
        classesList.push("ag-row-selected");
    }
    if (node.group) {
        // if a group, put the level of the group in
        classesList.push("ag-row-level-" + node.level);
    } else {
        // if a leaf, and a parent exists, put a level of the parent, else put level of 0 for top level item
        if (node.parent) {
            classesList.push("ag-row-level-" + (node.parent.level + 1));
        } else {
            classesList.push("ag-row-level-0");
        }
    }
    if (node.group) {
        classesList.push("ag-row-group");
    }
    if (node.group && !node.footer && node.expanded) {
        classesList.push("ag-row-group-expanded");
    }
    if (node.group && !node.footer && !node.expanded) {
        // opposite of expanded is contracted according to the internet.
        classesList.push("ag-row-group-contracted");
    }
    if (node.group && node.footer) {
        classesList.push("ag-row-footer");
    }

    // add in extra classes provided by the config
    if (this.gridOptionsWrapper.getRowClass()) {
        var params = {
            node: node,
            data: node.data,
            rowIndex: rowIndex,
            context: this.gridOptionsWrapper.getContext(),
            gridOptions: this.gridOptionsWrapper.getGridOptions()
        };
        var extraRowClasses = this.gridOptionsWrapper.getRowClass()(params);
        if (extraRowClasses) {
            if (typeof extraRowClasses === 'string') {
                classesList.push(extraRowClasses);
            } else if (Array.isArray(extraRowClasses)) {
                extraRowClasses.forEach(function(classItem) {
                    classesList.push(classItem);
                });
            }
        }
    }

    var classes = classesList.join(" ");

    eRow.className = classes;
};

RowRenderer.prototype.createRowContainer = function(rowIndex, node, groupRow) {
    var eRow = document.createElement("div");

    this.addClassesToRow(rowIndex, node, eRow);

    eRow.setAttribute("row", rowIndex);

    // if showing scrolls, position on the container
    if (!this.gridOptionsWrapper.isDontUseScrolls()) {
        eRow.style.top = (this.gridOptionsWrapper.getRowHeight() * rowIndex) + "px";
    }
    eRow.style.height = (this.gridOptionsWrapper.getRowHeight()) + "px";

    if (this.gridOptionsWrapper.getRowStyle()) {
        var cssToUse;
        var rowStyle = this.gridOptionsWrapper.getRowStyle();
        if (typeof rowStyle === 'function') {
            cssToUse = rowStyle(node.data, rowIndex, groupRow);
        } else {
            cssToUse = rowStyle;
        }

        if (cssToUse) {
            Object.keys(cssToUse).forEach(function(key) {
                eRow.style[key] = cssToUse[key];
            });
        }
    }

    var _this = this;
    eRow.addEventListener("click", function(event) {
        _this.angularGrid.onRowClicked(event, Number(this.getAttribute("row")), node)
    });

    return eRow;
};

RowRenderer.prototype.getIndexOfRenderedNode = function(node) {
    var renderedRows = this.renderedRows;
    var keys = Object.keys(renderedRows);
    for (var i = 0; i < keys.length; i++) {
        if (renderedRows[keys[i]].node === node) {
            return renderedRows[keys[i]].rowIndex;
        }
    }
    return -1;
};

RowRenderer.prototype.setCssClassForGroupCell = function(eGridGroupRow, footer, useEntireRow, firstColumnIndex) {
    if (useEntireRow) {
        if (footer) {
            eGridGroupRow.className = 'ag-footer-cell-entire-row';
        } else {
            eGridGroupRow.className = 'ag-group-cell-entire-row';
        }
    } else {
        if (footer) {
            eGridGroupRow.className = 'ag-footer-cell ag-cell cell-col-' + firstColumnIndex;
        } else {
            eGridGroupRow.className = 'ag-group-cell ag-cell cell-col-' + firstColumnIndex;
        }
    }
};

RowRenderer.prototype.createGroupElement = function(node, firstColumn, useEntireRow, padding, rowIndex, footer) {
    var eGridGroupRow = document.createElement('div');

    this.setCssClassForGroupCell(eGridGroupRow, footer, useEntireRow, firstColumn.index);

    var expandIconNeeded = !padding && !footer;
    if (expandIconNeeded) {
        this.addGroupExpandIcon(eGridGroupRow, node.expanded);
    }

    var checkboxNeeded = !padding && !footer && this.gridOptionsWrapper.isGroupCheckboxSelection();
    if (checkboxNeeded) {
        var eCheckbox = this.selectionRendererFactory.createSelectionCheckbox(node, rowIndex);
        eGridGroupRow.appendChild(eCheckbox);
    }

    // try user custom rendering first
    var useRenderer = typeof this.gridOptions.groupInnerCellRenderer === 'function';
    if (useRenderer) {
        var rendererParams = {
            data: node.data,
            node: node,
            padding: padding,
            gridOptions: this.gridOptions,
            context: this.gridOptionsWrapper.getContext()
        };
        utils.useRenderer(eGridGroupRow, this.gridOptions.groupInnerCellRenderer, rendererParams);
    } else {
        if (!padding) {
            if (footer) {
                this.createFooterCell(eGridGroupRow, node);
            } else {
                this.createGroupCell(eGridGroupRow, node);
            }
        }
    }

    if (!useEntireRow) {
        eGridGroupRow.style.width = utils.formatWidth(firstColumn.actualWidth);
    }

    // indent with the group level
    if (!padding) {
        // only do this if an indent - as this overwrites the padding that
        // the theme set, which will make things look 'not aligned' for the
        // first group level.
        if (node.footer || node.level > 0) {
            var paddingPx = node.level * 10;
            if (footer) {
                paddingPx += 10;
            }
            eGridGroupRow.style.paddingLeft = paddingPx + "px";
        }
    }

    var that = this;
    eGridGroupRow.addEventListener("click", function() {
        node.expanded = !node.expanded;
        that.angularGrid.updateModelAndRefresh(constants.STEP_MAP);
    });

    return eGridGroupRow;
};

// creates cell with 'Total {{key}}' for a group
RowRenderer.prototype.createFooterCell = function(eParent, node) {
    // if we are doing cell - then it makes sense to put in 'total', which is just a best guess,
    // that the user is going to want to say 'total'. typically i expect the user to override
    // how this cell is rendered
    var textToDisplay;
    if (this.gridOptionsWrapper.isGroupUseEntireRow()) {
        textToDisplay = "Group footer - you should provide a custom groupInnerCellRenderer to render what makes sense for you"
    } else {
        textToDisplay = "Total " + node.key;
    }
    var eText = document.createTextNode(textToDisplay);
    eParent.appendChild(eText);
};

// creates cell with '{{key}} ({{childCount}})' for a group
RowRenderer.prototype.createGroupCell = function(eParent, node) {
    var textToDisplay = " " + node.key;
    // only include the child count if it's included, eg if user doing custom aggregation,
    // then this could be left out, or set to -1, ie no child count
    if (node.allChildrenCount >= 0) {
        textToDisplay += " (" + node.allChildrenCount + ")";
    }
    var eText = document.createTextNode(textToDisplay);
    eParent.appendChild(eText);
};

RowRenderer.prototype.addGroupExpandIcon = function(eGridGroupRow, expanded) {
    var eGroupIcon;
    if (expanded) {
        eGroupIcon = utils.createIcon('groupExpanded', this.gridOptionsWrapper, null, svgFactory.createArrowDownSvg);
    } else {
        eGroupIcon = utils.createIcon('groupContracted', this.gridOptionsWrapper, null, svgFactory.createArrowRightSvg);
    }

    eGridGroupRow.appendChild(eGroupIcon);
};

RowRenderer.prototype.putDataIntoCell = function(colDef, value, node, $childScope, eGridCell, rowIndex) {
    if (colDef.cellRenderer) {
        var rendererParams = {
            value: value,
            data: node.data,
            node: node,
            colDef: colDef,
            $scope: $childScope,
            rowIndex: rowIndex,
            gridOptions: this.gridOptionsWrapper.getGridOptions(),
            context: this.gridOptionsWrapper.getContext()
        };
        var resultFromRenderer = colDef.cellRenderer(rendererParams);
        if (utils.isNode(resultFromRenderer) || utils.isElement(resultFromRenderer)) {
            // a dom node or element was returned, so add child
            eGridCell.appendChild(resultFromRenderer);
        } else {
            // otherwise assume it was html, so just insert
            eGridCell.innerHTML = resultFromRenderer;
        }
    } else {
        // if we insert undefined, then it displays as the string 'undefined', ugly!
        if (value !== undefined && value !== null && value !== '') {
            eGridCell.innerHTML = value;
        }
    }
};

RowRenderer.prototype.createCell = function(isFirstColumn, column, value, node, rowIndex, $childScope) {
    var that = this;
    var eGridCell = document.createElement("div");
    eGridCell.setAttribute("col", column.index);

    // set class, only include ag-group-cell if it's a group cell
    var classes = ['ag-cell', 'cell-col-' + column.index];
    if (node.group) {
        if (node.footer) {
            classes.push('ag-footer-cell');
        } else {
            classes.push('ag-group-cell');
        }
    }
    eGridCell.className = classes.join(' ');

    var eCellWrapper = document.createElement('span');
    eGridCell.appendChild(eCellWrapper);

    // see if we need a padding box
    if (isFirstColumn && (node.parent)) {
        var pixelsToIndent = 20 + (node.parent.level * 10);
        eCellWrapper.style['padding-left'] = pixelsToIndent + 'px';
    }

    var colDef = column.colDef;
    if (colDef.checkboxSelection) {
        var eCheckbox = this.selectionRendererFactory.createSelectionCheckbox(node, rowIndex);
        eCellWrapper.appendChild(eCheckbox);
    }

    var eSpanWithValue = document.createElement("span");
    eCellWrapper.appendChild(eSpanWithValue);
    this.putDataIntoCell(colDef, value, node, $childScope, eSpanWithValue, rowIndex);

    if (colDef.cellStyle) {
        var cssToUse;
        if (typeof colDef.cellStyle === 'function') {
            var cellStyleParams = {
                value: value,
                data: node.data,
                node: node,
                colDef: colDef,
                $scope: $childScope,
                context: this.gridOptionsWrapper.getContext(),
                gridOptions: this.gridOptionsWrapper.getGridOptions()
            };
            cssToUse = colDef.cellStyle(cellStyleParams);
        } else {
            cssToUse = colDef.cellStyle;
        }

        if (cssToUse) {
            Object.keys(cssToUse).forEach(function(key) {
                eGridCell.style[key] = cssToUse[key];
            });
        }
    }

    if (colDef.cellClass) {
        var classToUse;
        if (typeof colDef.cellClass === 'function') {
            var cellClassParams = {
                value: value,
                data: node.data,
                node: node,
                colDef: colDef,
                $scope: $childScope,
                context: this.gridOptionsWrapper.getContext(),
                gridOptions: this.gridOptionsWrapper.getGridOptions()
            };
            classToUse = colDef.cellClass(cellClassParams);
        } else {
            classToUse = colDef.cellClass;
        }

        if (typeof classToUse === 'string') {
            utils.addCssClass(eGridCell, classToUse);
        } else if (Array.isArray(classToUse)) {
            classToUse.forEach(function(cssClassItem) {
                utils.addCssClass(eGridCell, cssClassItem);
            });
        }
    }

    this.addCellClickedHandler(eGridCell, node, column, value, rowIndex);
    this.addCellDoubleClickedHandler(eGridCell, node, column, value, rowIndex, $childScope);

    eGridCell.style.width = utils.formatWidth(column.actualWidth);

    // add the 'start editing' call to the chain of editors
    this.renderedRowStartEditingListeners[rowIndex][column.index] = function() {
        if (that.isCellEditable(colDef, node)) {
            that.startEditing(eGridCell, column, node, $childScope, rowIndex);
            return true;
        } else {
            return false;
        }
    };

    return eGridCell;
};

RowRenderer.prototype.addCellDoubleClickedHandler = function(eGridCell, node, column, value, rowIndex, $childScope) {
    var that = this;
    var colDef = column.colDef;
    eGridCell.addEventListener("dblclick", function(event) {
        if (that.gridOptionsWrapper.getCellDoubleClicked()) {
            var paramsForGrid = {
                node: node,
                data: node.data,
                value: value,
                rowIndex: rowIndex,
                colDef: colDef,
                event: event,
                eventSource: this,
                gridOptions: that.gridOptionsWrapper.getGridOptions()
            };
            that.gridOptionsWrapper.getCellDoubleClicked()(paramsForGrid);
        }
        if (colDef.cellDoubleClicked) {
            var paramsForColDef = {
                node: node,
                data: node.data,
                value: value,
                rowIndex: rowIndex,
                colDef: colDef,
                event: event,
                eventSource: this,
                gridOptions: that.gridOptionsWrapper.getGridOptions()
            };
            colDef.cellDoubleClicked(paramsForColDef);
        }
        if (that.isCellEditable(colDef, node)) {
            that.startEditing(eGridCell, column, node, $childScope, rowIndex);
        }
    });
};

RowRenderer.prototype.addCellClickedHandler = function(eGridCell, node, colDefWrapper, value, rowIndex) {
    var that = this;
    var colDef = colDefWrapper.colDef;
    eGridCell.addEventListener("click", function(event) {
        if (that.gridOptionsWrapper.getCellClicked()) {
            var paramsForGrid = {
                node: node,
                data: node.data,
                value: value,
                rowIndex: rowIndex,
                colDef: colDef,
                event: event,
                eventSource: this,
                gridOptions: that.gridOptionsWrapper.getGridOptions()
            };
            that.gridOptionsWrapper.getCellClicked()(paramsForGrid);
        }
        if (colDef.cellClicked) {
            var paramsForColDef = {
                node: node,
                data: node.data,
                value: value,
                rowIndex: rowIndex,
                colDef: colDef,
                event: event,
                eventSource: this,
                gridOptions: that.gridOptionsWrapper.getGridOptions()
            };
            colDef.cellClicked(paramsForColDef);
        }
    });
};

RowRenderer.prototype.isCellEditable = function(colDef, node) {
    if (this.editingCell) {
        return false;
    }

    // never allow editing of groups
    if (node.group) {
        return false;
    }

    // if boolean set, then just use it
    if (typeof colDef.editable === 'boolean') {
        return colDef.editable;
    }

    // if function, then call the function to find out
    if (typeof colDef.editable === 'function') {
        // should change this, so it gets passed params with nice useful values
        return colDef.editable(node.data);
    }

    return false;
};

RowRenderer.prototype.stopEditing = function(eGridCell, colDef, node, $childScope, eInput, blurListener, rowIndex) {
    this.editingCell = false;
    var newValue = eInput.value;

    //If we don't remove the blur listener first, we get:
    //Uncaught NotFoundError: Failed to execute 'removeChild' on 'Node': The node to be removed is no longer a child of this node. Perhaps it was moved in a 'blur' event handler?
    eInput.removeEventListener('blur', blurListener);

    utils.removeAllChildren(eGridCell);

    var paramsForCallbacks = {
        node: node,
        data: node.data,
        oldValue: node.data[colDef.field],
        newValue: newValue,
        rowIndex: rowIndex,
        colDef: colDef,
        context: this.gridOptionsWrapper.getContext(),
        gridOptions: this.gridOptionsWrapper.getGridOptions()
    };

    if (colDef.newValueHandler) {
        colDef.newValueHandler(paramsForCallbacks);
    } else {
        node.data[colDef.field] = newValue;
    }

    // at this point, the value has been updated
    paramsForCallbacks.newValue = node.data[colDef.field];
    if (typeof colDef.cellValueChanged === 'function') {
        colDef.cellValueChanged(paramsForCallbacks);
    }

    var value = node.data[colDef.field];
    this.putDataIntoCell(colDef, value, node, $childScope, eGridCell);
};

RowRenderer.prototype.startEditing = function(eGridCell, column, node, $childScope, rowIndex) {
    var that = this;
    var colDef = column.colDef;
    this.editingCell = true;
    utils.removeAllChildren(eGridCell);
    var eInput = document.createElement('input');
    eInput.type = 'text';
    utils.addCssClass(eInput, 'ag-cell-edit-input');

    var value = node.data[colDef.field];
    if (value !== null && value !== undefined) {
        eInput.value = value;
    }

    eInput.style.width = (column.actualWidth - 14) + 'px';
    eGridCell.appendChild(eInput);
    eInput.focus();
    eInput.select();

    var blurListener = function() {
        that.stopEditing(eGridCell, colDef, node, $childScope, eInput, blurListener, rowIndex);
    };

    //stop entering if we loose focus
    eInput.addEventListener("blur", blurListener);

    //stop editing if enter pressed
    eInput.addEventListener('keypress', function(event) {
        var key = event.which || event.keyCode;
        // 13 is enter
        if (key == ENTER_KEY) {
            that.stopEditing(eGridCell, colDef, node, $childScope, eInput, blurListener, rowIndex);
        }
    });

    // tab key doesn't generate keypress, so need keydown to listen for that
    eInput.addEventListener('keydown', function(event) {
        var key = event.which || event.keyCode;
        if (key == TAB_KEY) {
            that.stopEditing(eGridCell, colDef, node, $childScope, eInput, blurListener, rowIndex);
            that.startEditingNextCell(rowIndex, column, event.shiftKey);
            // we don't want the default tab action, so return false, this stops the event from bubbling
            event.preventDefault();
            return false;
        }
    });
};

RowRenderer.prototype.startEditingNextCell = function(rowIndex, column, shiftKey) {

    var firstRowToCheck = this.firstVirtualRenderedRow;
    var lastRowToCheck = this.lastVirtualRenderedRow;
    var currentRowIndex = rowIndex;

    var visibleColumns = this.columnModel.getVisibleColumns();
    var currentCol = column;

    while (true) {

        var indexOfCurrentCol = visibleColumns.indexOf(currentCol);

        // move backward
        if (shiftKey) {
            // move along to the previous cell
            currentCol = visibleColumns[indexOfCurrentCol - 1];
            // check if end of the row, and if so, go back a row
            if (!currentCol) {
                currentCol = visibleColumns[visibleColumns.length - 1];
                currentRowIndex--;
            }

            // if got to end of rendered rows, then quit looking
            if (currentRowIndex < firstRowToCheck) {
                return;
            }
            // move forward
        } else {
            // move along to the next cell
            currentCol = visibleColumns[indexOfCurrentCol + 1];
            // check if end of the row, and if so, go forward a row
            if (!currentCol) {
                currentCol = visibleColumns[0];
                currentRowIndex++;
            }

            // if got to end of rendered rows, then quit looking
            if (currentRowIndex > lastRowToCheck) {
                return;
            }
        }

        var nextFunc = this.renderedRowStartEditingListeners[currentRowIndex][currentCol.colKey];
        if (nextFunc) {
            // see if the next cell is editable, and if so, we have come to
            // the end of our search, so stop looking for the next cell
            var nextCellAcceptedEdit = nextFunc();
            if (nextCellAcceptedEdit) {
                return;
            }
        }
    }

};

module.exports = RowRenderer;

},{"./constants":3,"./svgFactory":21,"./utils":24}],19:[function(require,module,exports){
var utils = require('./utils');

// these constants are used for determining if groups should
// be selected or deselected when selecting groups, and the group
// then selects the children.
var SELECTED = 0;
var UNSELECTED = 1;
var MIXED = 2;
var DO_NOT_CARE = 3;

function SelectionController() {}

SelectionController.prototype.init = function(angularGrid, eRowsParent, gridOptionsWrapper, $scope, rowRenderer) {
    this.eRowsParent = eRowsParent;
    this.angularGrid = angularGrid;
    this.gridOptionsWrapper = gridOptionsWrapper;
    this.$scope = $scope;
    this.rowRenderer = rowRenderer;

    this.selectedNodesById = {};
    this.selectedRows = [];

    gridOptionsWrapper.setSelectedRows(this.selectedRows);
    gridOptionsWrapper.setSelectedNodesById(this.selectedNodesById);
};

SelectionController.prototype.getSelectedNodes = function() {
    var selectedNodes = [];
    var keys = Object.keys(this.selectedNodesById);
    for (var i = 0; i < keys.length; i++) {
        var id = keys[i];
        var selectedNode = this.selectedNodesById[id];
        selectedNodes.push(selectedNode);
    }
    return selectedNodes;
};

// returns a list of all nodes at 'best cost' - a feature to be used
// with groups / trees. if a group has all it's children selected,
// then the group appears in the result, but not the children.
// Designed for use with 'children' as the group selection type,
// where groups don't actually appear in the selection normally.
SelectionController.prototype.getBestCostNodeSelection = function() {

    var topLevelNodes = this.rowModel.getTopLevelNodes();

    var result = [];
    var that = this;

    // recursive function, to find the selected nodes
    function traverse(nodes) {
        for (var i = 0, l = nodes.length; i < l; i++) {
            var node = nodes[i];
            if (that.isNodeSelected(node)) {
                result.push(node);
            } else {
                // if not selected, then if it's a group, and the group
                // has children, continue to search for selections
                if (node.group && node.children) {
                    traverse(node.children);
                }
            }
        }
    }

    traverse(topLevelNodes);

    return result;
};

SelectionController.prototype.setRowModel = function(rowModel) {
    this.rowModel = rowModel;
};

// public - this clears the selection, but doesn't clear down the css - when it is called, the
// caller then gets the grid to refresh.
SelectionController.prototype.clearSelection = function() {
    this.selectedRows.length = 0;
    var keys = Object.keys(this.selectedNodesById);
    for (var i = 0; i < keys.length; i++) {
        delete this.selectedNodesById[keys[i]];
    }
};

// public
SelectionController.prototype.selectNode = function(node, tryMulti, suppressEvents) {
    var multiSelect = this.gridOptionsWrapper.isRowSelectionMulti() && tryMulti;

    // if the node is a group, then selecting this is the same as selecting the parent,
    // so to have only one flow through the below, we always select the header parent
    // (which then has the side effect of selecting the child).
    var nodeToSelect;
    if (node.footer) {
        nodeToSelect = node.sibling;
    } else {
        nodeToSelect = node;
    }

    // at the end, if this is true, we inform the callback
    var atLeastOneItemUnselected = false;
    var atLeastOneItemSelected = false;

    // see if rows to be deselected
    if (!multiSelect) {
        atLeastOneItemUnselected = this.doWorkOfDeselectAllNodes();
    }

    if (this.gridOptionsWrapper.isGroupCheckboxSelectionChildren() && nodeToSelect.group) {
        // don't select the group, select the children instead
        atLeastOneItemSelected = this.recursivelySelectAllChildren(nodeToSelect);
    } else {
        // see if row needs to be selected
        atLeastOneItemSelected = this.doWorkOfSelectNode(nodeToSelect, suppressEvents);
    }

    if (atLeastOneItemUnselected || atLeastOneItemSelected) {
        this.syncSelectedRowsAndCallListener(suppressEvents);
    }

    this.updateGroupParentsIfNeeded();
};

SelectionController.prototype.recursivelySelectAllChildren = function(node, suppressEvents) {
    var atLeastOne = false;
    if (node.children) {
        for (var i = 0; i < node.children.length; i++) {
            var child = node.children[i];
            if (child.group) {
                if (this.recursivelySelectAllChildren(child)) {
                    atLeastOne = true;
                }
            } else {
                if (this.doWorkOfSelectNode(child, suppressEvents)) {
                    atLeastOne = true;
                }
            }
        }
    }
    return atLeastOne;
};

SelectionController.prototype.recursivelyDeselectAllChildren = function(node) {
    if (node.children) {
        for (var i = 0; i < node.children.length; i++) {
            var child = node.children[i];
            if (child.group) {
                this.recursivelyDeselectAllChildren(child);
            } else {
                this.deselectRealNode(child);
            }
        }
    }
};

// private
// 1 - selects a node
// 2 - updates the UI
// 3 - calls callbacks
SelectionController.prototype.doWorkOfSelectNode = function(node, suppressEvents) {
    if (this.selectedNodesById[node.id]) {
        return false;
    }

    this.selectedNodesById[node.id] = node;

    this.addCssClassForNode_andInformVirtualRowListener(node);

    // also color in the footer if there is one
    if (node.group && node.expanded && node.sibling) {
        this.addCssClassForNode_andInformVirtualRowListener(node.sibling);
    }

    // inform the rowSelected listener, if any
    if (!suppressEvents && typeof this.gridOptionsWrapper.getRowSelected() === "function") {
        this.gridOptionsWrapper.getRowSelected()(node.data, node);
    }

    return true;
};

// private
// 1 - selects a node
// 2 - updates the UI
// 3 - calls callbacks
// wow - what a big name for a method, exception case, it's saying what the method does
SelectionController.prototype.addCssClassForNode_andInformVirtualRowListener = function(node) {
    var virtualRenderedRowIndex = this.rowRenderer.getIndexOfRenderedNode(node);
    if (virtualRenderedRowIndex >= 0) {
        utils.querySelectorAll_addCssClass(this.eRowsParent, '[row="' + virtualRenderedRowIndex + '"]', 'ag-row-selected');

        // inform virtual row listener
        this.angularGrid.onVirtualRowSelected(virtualRenderedRowIndex, true);
    }
};

// private
// 1 - un-selects a node
// 2 - updates the UI
// 3 - calls callbacks
SelectionController.prototype.doWorkOfDeselectAllNodes = function(nodeToKeepSelected) {
    // not doing multi-select, so deselect everything other than the 'just selected' row
    var atLeastOneSelectionChange;
    var selectedNodeKeys = Object.keys(this.selectedNodesById);
    for (var i = 0; i < selectedNodeKeys.length; i++) {
        // skip the 'just selected' row
        var key = selectedNodeKeys[i];
        var nodeToDeselect = this.selectedNodesById[key];
        if (nodeToDeselect === nodeToKeepSelected) {
            continue;
        } else {
            this.deselectRealNode(nodeToDeselect);
            atLeastOneSelectionChange = true;
        }
    }
    return atLeastOneSelectionChange;
};

// private
SelectionController.prototype.deselectRealNode = function(node) {
    // deselect the css
    this.removeCssClassForNode(node);

    // if node is a header, and if it has a sibling footer, deselect the footer also
    if (node.group && node.expanded && node.sibling) { // also check that it's expanded, as sibling could be a ghost
        this.removeCssClassForNode(node.sibling);
    }

    // remove the row
    delete this.selectedNodesById[node.id];
};

// private
SelectionController.prototype.removeCssClassForNode = function(node) {
    var virtualRenderedRowIndex = this.rowRenderer.getIndexOfRenderedNode(node);
    if (virtualRenderedRowIndex >= 0) {
        utils.querySelectorAll_removeCssClass(this.eRowsParent, '[row="' + virtualRenderedRowIndex + '"]', 'ag-row-selected');
        // inform virtual row listener
        this.angularGrid.onVirtualRowSelected(virtualRenderedRowIndex, false);
    }
};

// public (selectionRendererFactory)
SelectionController.prototype.deselectIndex = function(rowIndex) {
    var node = this.rowModel.getVirtualRow(rowIndex);
    this.deselectNode(node);
};

// public (api)
SelectionController.prototype.deselectNode = function(node) {
    if (node) {
        if (this.gridOptionsWrapper.isGroupCheckboxSelectionChildren() && node.group) {
            // want to deselect children, not this node, so recursively deselect
            this.recursivelyDeselectAllChildren(node);
        } else {
            this.deselectRealNode(node);
        }
    }
    this.syncSelectedRowsAndCallListener();
    this.updateGroupParentsIfNeeded();
};

// public (selectionRendererFactory & api)
SelectionController.prototype.selectIndex = function(index, tryMulti, suppressEvents) {
    var node = this.rowModel.getVirtualRow(index);
    this.selectNode(node, tryMulti, suppressEvents);
};

// private
// updates the selectedRows with the selectedNodes and calls selectionChanged listener
SelectionController.prototype.syncSelectedRowsAndCallListener = function(suppressEvents) {
    // update selected rows
    var selectedRows = this.selectedRows;
    // clear selected rows
    selectedRows.length = 0;
    var keys = Object.keys(this.selectedNodesById);
    for (var i = 0; i < keys.length; i++) {
        if (this.selectedNodesById[keys[i]] !== undefined) {
            var selectedNode = this.selectedNodesById[keys[i]];
            selectedRows.push(selectedNode.data);
        }
    }

    if (!suppressEvents && typeof this.gridOptionsWrapper.getSelectionChanged() === "function") {
        this.gridOptionsWrapper.getSelectionChanged()();
    }

    var that = this;
    setTimeout(function() {
        that.$scope.$apply();
    }, 0);
};

// private
SelectionController.prototype.recursivelyCheckIfSelected = function(node) {
    var foundSelected = false;
    var foundUnselected = false;

    if (node.children) {
        for (var i = 0; i < node.children.length; i++) {
            var child = node.children[i];
            var result;
            if (child.group) {
                result = this.recursivelyCheckIfSelected(child);
                switch (result) {
                    case SELECTED:
                        foundSelected = true;
                        break;
                    case UNSELECTED:
                        foundUnselected = true;
                        break;
                    case MIXED:
                        foundSelected = true;
                        foundUnselected = true;
                        break;
                        // we can ignore the DO_NOT_CARE, as it doesn't impact, means the child
                        // has no children and shouldn't be considered when deciding
                }
            } else {
                if (this.isNodeSelected(child)) {
                    foundSelected = true;
                } else {
                    foundUnselected = true;
                }
            }

            if (foundSelected && foundUnselected) {
                // if mixed, then no need to go further, just return up the chain
                return MIXED;
            }
        }
    }

    // got this far, so no conflicts, either all children selected, unselected, or neither
    if (foundSelected) {
        return SELECTED;
    } else if (foundUnselected) {
        return UNSELECTED;
    } else {
        return DO_NOT_CARE;
    }
};

// public (selectionRendererFactory)
// returns:
// true: if selected
// false: if unselected
// undefined: if it's a group and 'children selection' is used and 'children' are a mix of selected and unselected
SelectionController.prototype.isNodeSelected = function(node) {
    if (this.gridOptionsWrapper.isGroupCheckboxSelectionChildren() && node.group) {
        // doing child selection, we need to traverse the children
        var resultOfChildren = this.recursivelyCheckIfSelected(node);
        switch (resultOfChildren) {
            case SELECTED:
                return true;
            case UNSELECTED:
                return false;
            default:
                return undefined;
        }
    } else {
        return this.selectedNodesById[node.id] !== undefined;
    }
};

SelectionController.prototype.updateGroupParentsIfNeeded = function() {
    // we only do this if parent nodes are responsible
    // for selecting their children.
    if (!this.gridOptionsWrapper.isGroupCheckboxSelectionChildren()) {
        return;
    }

    var firstRow = this.rowRenderer.getFirstVirtualRenderedRow();
    var lastRow = this.rowRenderer.getLastVirtualRenderedRow();
    for (var rowIndex = firstRow; rowIndex <= lastRow; rowIndex++) {
        // see if node is a group
        var node = this.rowModel.getVirtualRow(rowIndex);
        if (node.group) {
            var selected = this.isNodeSelected(node);
            this.angularGrid.onVirtualRowSelected(rowIndex, selected);

            if (selected) {
                utils.querySelectorAll_addCssClass(this.eRowsParent, '[row="' + rowIndex + '"]', 'ag-row-selected');
            } else {
                utils.querySelectorAll_removeCssClass(this.eRowsParent, '[row="' + rowIndex + '"]', 'ag-row-selected');
            }
        }
    }
};

module.exports = SelectionController;

},{"./utils":24}],20:[function(require,module,exports){
function SelectionRendererFactory() {}

SelectionRendererFactory.prototype.init = function(angularGrid, selectionController) {
    this.angularGrid = angularGrid;
    this.selectionController = selectionController;
};

SelectionRendererFactory.prototype.createCheckboxColDef = function() {
    return {
        width: 30,
        suppressMenu: true,
        suppressSorting: true,
        headerCellRenderer: function() {
            var eCheckbox = document.createElement('input');
            eCheckbox.type = 'checkbox';
            eCheckbox.name = 'name';
            return eCheckbox;
        },
        cellRenderer: this.createCheckboxRenderer()
    };
};

SelectionRendererFactory.prototype.createCheckboxRenderer = function() {
    var that = this;
    return function(params) {
        return that.createSelectionCheckbox(params.node, params.rowIndex);
    };
};

SelectionRendererFactory.prototype.createSelectionCheckbox = function(node, rowIndex) {

    var eCheckbox = document.createElement('input');
    eCheckbox.type = "checkbox";
    eCheckbox.name = "name";
    eCheckbox.className = 'ag-selection-checkbox';
    setCheckboxState(eCheckbox, this.selectionController.isNodeSelected(node));

    var that = this;
    eCheckbox.onclick = function(event) {
        event.stopPropagation();
    };

    eCheckbox.onchange = function() {
        var newValue = eCheckbox.checked;
        if (newValue) {
            that.selectionController.selectIndex(rowIndex, true);
        } else {
            that.selectionController.deselectIndex(rowIndex);
        }
    };

    this.angularGrid.addVirtualRowListener(rowIndex, {
        rowSelected: function(selected) {
            setCheckboxState(eCheckbox, selected);
        },
        rowRemoved: function() {}
    });

    return eCheckbox;
};

function setCheckboxState(eCheckbox, state) {
    if (typeof state === 'boolean') {
        eCheckbox.checked = state;
        eCheckbox.indeterminate = false;
    } else {
        // isNodeSelected returns back undefined if it's a group and the children
        // are a mix of selected and unselected
        eCheckbox.indeterminate = true;
    }
}

module.exports = SelectionRendererFactory;

},{}],21:[function(require,module,exports){
var SVG_NS = "http://www.w3.org/2000/svg";

function SvgFactory() {}

SvgFactory.prototype.createFilterSvg = function() {
    var eSvg = createIconSvg();

    var eFunnel = document.createElementNS(SVG_NS, "polygon");
    eFunnel.setAttribute("points", "0,0 4,4 4,10 6,10 6,4 10,0");
    eFunnel.setAttribute("class", "ag-header-icon");
    eSvg.appendChild(eFunnel);

    return eSvg;
};

SvgFactory.prototype.createMenuSvg = function() {
    var eSvg = document.createElementNS(SVG_NS, "svg");
    var size = "12";
    eSvg.setAttribute("width", size);
    eSvg.setAttribute("height", size);

    ["0", "5", "10"].forEach(function(y) {
        var eLine = document.createElementNS(SVG_NS, "rect");
        eLine.setAttribute("y", y);
        eLine.setAttribute("width", size);
        eLine.setAttribute("height", "2");
        eLine.setAttribute("class", "ag-header-icon");
        eSvg.appendChild(eLine);
    });

    return eSvg;
};

SvgFactory.prototype.createArrowUpSvg = function() {
    return createPolygonSvg("0,10 5,0 10,10");
};

SvgFactory.prototype.createArrowLeftSvg = function() {
    return createPolygonSvg("10,0 0,5 10,10");
};

SvgFactory.prototype.createArrowDownSvg = function() {
    return createPolygonSvg("0,0 5,10 10,0");
};

SvgFactory.prototype.createArrowRightSvg = function() {
    return createPolygonSvg("0,0 10,5 0,10");
};

function createPolygonSvg(points) {
    var eSvg = createIconSvg();

    var eDescIcon = document.createElementNS(SVG_NS, "polygon");
    eDescIcon.setAttribute("points", points);
    eSvg.appendChild(eDescIcon);

    return eSvg;
}

// util function for the above
function createIconSvg() {
    var eSvg = document.createElementNS(SVG_NS, "svg");
    eSvg.setAttribute("width", "10");
    eSvg.setAttribute("height", "10");
    return eSvg;
}

module.exports = SvgFactory;

},{}],22:[function(require,module,exports){
var template = [
    '<div class="ag-root ag-scrolls">',
    '    <!-- The loading panel -->',
    '    <!-- wrapping in outer div, and wrapper, is needed to center the loading icon -->',
    '    <!-- The idea for centering came from here: http://www.vanseodesign.com/css/vertical-centering/ -->',
    '    <div class="ag-loading-panel">',
    '        <div class="ag-loading-wrapper">',
    '            <span class="ag-loading-center">Loading...</span>',
    '        </div>',
    '    </div>',
    '    <!-- header -->',
    '    <div class="ag-header">',
    '        <div class="ag-pinned-header"></div><div class="ag-header-viewport"><div class="ag-header-container"></div></div>',
    '    </div>',
    '    <!-- body -->',
    '    <div class="ag-body">',
    '        <div class="ag-pinned-cols-viewport">',
    '            <div class="ag-pinned-cols-container"></div>',
    '        </div>',
    '        <div class="ag-body-viewport-wrapper">',
    '            <div class="ag-body-viewport">',
    '                <div class="ag-body-container"></div>',
    '            </div>',
    '        </div>',
    '    </div>',
    '    <!-- Paging -->',
    '    <div class="ag-paging-panel">',
    '    </div>',
    '    </div>'
].join('');

module.exports = template;

},{}],23:[function(require,module,exports){
var template = [
    '<div class="ag-root ag-no-scrolls">',
    '    <!-- See comment in template.html for why loading is laid out like so -->',
    '    <div class="ag-loading-panel">',
    '        <div class="ag-loading-wrapper">',
    '            <span class="ag-loading-center">Loading...</span>',
    '        </div>',
    '    </div>',
    '    <!-- header -->',
    '    <div class="ag-header-container"></div>',
    '    <!-- body -->',
    '    <div class="ag-body-container"></div>',
    '</div>'
].join('');


module.exports = template;

},{}],24:[function(require,module,exports){
function Utils() {}

//Returns true if it is a DOM node
//taken from: http://stackoverflow.com/questions/384286/javascript-isdom-how-do-you-check-if-a-javascript-object-is-a-dom-object
Utils.prototype.isNode = function(o) {
    return (
        typeof Node === "object" ? o instanceof Node :
        o && typeof o === "object" && typeof o.nodeType === "number" && typeof o.nodeName === "string"
    );
};

//Returns true if it is a DOM element
//taken from: http://stackoverflow.com/questions/384286/javascript-isdom-how-do-you-check-if-a-javascript-object-is-a-dom-object
Utils.prototype.isElement = function(o) {
    return (
        typeof HTMLElement === "object" ? o instanceof HTMLElement : //DOM2
        o && typeof o === "object" && o !== null && o.nodeType === 1 && typeof o.nodeName === "string"
    );
};

Utils.prototype.isNodeOrElement = function(o) {
    return this.isNode(o) || this.isElement(o);
};

//adds all type of change listeners to an element, intended to be a text field
Utils.prototype.addChangeListener = function(element, listener) {
    element.addEventListener("changed", listener);
    element.addEventListener("paste", listener);
    element.addEventListener("input", listener);
};

//if value is undefined, null or blank, returns null, otherwise returns the value
Utils.prototype.makeNull = function(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    } else {
        return value;
    }
};

Utils.prototype.removeAllChildren = function(node) {
    if (node) {
        while (node.hasChildNodes()) {
            node.removeChild(node.lastChild);
        }
    }
};

//adds an element to a div, but also adds a background checking for clicks,
//so that when the background is clicked, the child is removed again, giving
//a model look to popups.
Utils.prototype.addAsModalPopup = function(eParent, eChild) {
    var eBackdrop = document.createElement("div");
    eBackdrop.className = "ag-popup-backdrop";

    eBackdrop.onclick = function() {
        eParent.removeChild(eChild);
        eParent.removeChild(eBackdrop);
    };

    eParent.appendChild(eBackdrop);
    eParent.appendChild(eChild);
};

//loads the template and returns it as an element. makes up for no simple way in
//the dom api to load html directly, eg we cannot do this: document.createElement(template)
Utils.prototype.loadTemplate = function(template) {
    var tempDiv = document.createElement("div");
    tempDiv.innerHTML = template;
    return tempDiv.firstChild;
};

//if passed '42px' then returns the number 42
Utils.prototype.pixelStringToNumber = function(val) {
    if (typeof val === "string") {
        if (val.indexOf("px") >= 0) {
            val.replace("px", "");
        }
        return parseInt(val);
    } else {
        return val;
    }
};

Utils.prototype.querySelectorAll_addCssClass = function(eParent, selector, cssClass) {
    var eRows = eParent.querySelectorAll(selector);
    for (var k = 0; k < eRows.length; k++) {
        this.addCssClass(eRows[k], cssClass);
    }
};

Utils.prototype.querySelectorAll_removeCssClass = function(eParent, selector, cssClass) {
    var eRows = eParent.querySelectorAll(selector);
    for (var k = 0; k < eRows.length; k++) {
        this.removeCssClass(eRows[k], cssClass);
    }
};

Utils.prototype.addCssClass = function(element, className) {
    var oldClasses = element.className;
    if (oldClasses) {
        if (oldClasses.indexOf(className) >= 0) {
            return;
        }
        element.className = oldClasses + " " + className;
    } else {
        element.className = className;
    }
};

Utils.prototype.removeCssClass = function(element, className) {
    var oldClasses = element.className;
    if (oldClasses.indexOf(className) < 0) {
        return;
    }
    var newClasses = oldClasses.replace(" " + className, "");
    newClasses = newClasses.replace(className + " ", "");
    if (newClasses == className) {
        newClasses = "";
    }
    element.className = newClasses;
};

Utils.prototype.removeFromArray = function(array, object) {
    array.splice(array.indexOf(object), 1);
};

Utils.prototype.defaultComparator = function(valueA, valueB) {
    var valueAMissing = valueA === null || valueA === undefined;
    var valueBMissing = valueB === null || valueB === undefined;
    if (valueAMissing && valueBMissing) {
        return 0;
    }
    if (valueAMissing) {
        return -1;
    }
    if (valueBMissing) {
        return 1;
    }

    if (valueA < valueB) {
        return -1;
    } else if (valueA > valueB) {
        return 1;
    } else {
        return 0;
    }
};

Utils.prototype.formatWidth = function(width) {
    if (typeof width === "number") {
        return width + "px";
    } else {
        return width;
    }
};

// tries to use the provided renderer. if a renderer found, returns true.
// if no renderer, returns false.
Utils.prototype.useRenderer = function(eParent, eRenderer, params) {
    var resultFromRenderer = eRenderer(params);
    if (this.isNode(resultFromRenderer) || this.isElement(resultFromRenderer)) {
        //a dom node or element was returned, so add child
        eParent.appendChild(resultFromRenderer);
    } else {
        //otherwise assume it was html, so just insert
        var eTextSpan = document.createElement('span');
        eTextSpan.innerHTML = resultFromRenderer;
        eParent.appendChild(eTextSpan);
    }
};

// if icon provided, use this (either a string, or a function callback).
// if not, then use the second parameter, which is the svgFactory function
Utils.prototype.createIcon = function(iconName, gridOptionsWrapper, colDefWrapper, svgFactoryFunc) {
    var eResult = document.createElement('span');
    var userProvidedIcon;
    // check col for icon first
    if (colDefWrapper && colDefWrapper.colDef.icons) {
        userProvidedIcon = colDefWrapper.colDef.icons[iconName];
    }
    // it not in col, try grid options
    if (!userProvidedIcon && gridOptionsWrapper.getIcons()) {
        userProvidedIcon = gridOptionsWrapper.getIcons()[iconName];
    }
    // now if user provided, use it
    if (userProvidedIcon) {
        var rendererResult;
        if (typeof userProvidedIcon === 'function') {
            rendererResult = userProvidedIcon();
        } else if (typeof userProvidedIcon === 'string') {
            rendererResult = userProvidedIcon;
        } else {
            throw 'icon from grid options needs to be a string or a function';
        }
        if (typeof rendererResult === 'string') {
            eResult.innerHTML = rendererResult;
        } else if (this.isNodeOrElement(rendererResult)) {
            eResult.appendChild(rendererResult);
        } else {
            throw 'iconRenderer should return back a string or a dom object';
        }
    } else {
        // otherwise we use the built in icon
        eResult.appendChild(svgFactoryFunc());
    }
    return eResult;
};

module.exports = new Utils();

},{}],25:[function(require,module,exports){
/*
 * This row controller is used for infinite scrolling only. For normal 'in memory' table,
 * or standard pagination, the inMemoryRowController is used.
 */

var logging = true;

function VirtualPageRowController() {}

VirtualPageRowController.prototype.init = function(rowRenderer) {
    this.rowRenderer = rowRenderer;
    this.datasourceVersion = 0;
};

VirtualPageRowController.prototype.setDatasource = function(datasource) {
    this.datasource = datasource;

    if (!datasource) {
        // only continue if we have a valid datasource to working with
        return;
    }

    this.reset();
};

VirtualPageRowController.prototype.reset = function() {
    // see if datasource knows how many rows there are
    if (typeof this.datasource.rowCount === 'number' && this.datasource.rowCount >= 0) {
        this.virtualRowCount = this.datasource.rowCount;
        this.foundMaxRow = true;
    } else {
        this.virtualRowCount = 0;
        this.foundMaxRow = false;
    }

    // in case any daemon requests coming from datasource, we know it ignore them
    this.datasourceVersion++;

    // map of page numbers to rows in that page
    this.pageCache = {};
    this.pageCacheSize = 0;

    // if a number is in this array, it means we are pending a load from it
    this.pageLoadsInProgress = [];
    this.pageLoadsQueued = [];
    this.pageAccessTimes = {}; // keeps a record of when each page was last viewed, used for LRU cache
    this.accessTime = 0; // rather than using the clock, we use this counter

    // the number of concurrent loads we are allowed to the server
    if (typeof this.datasource.maxConcurrentRequests === 'number' && this.datasource.maxConcurrentRequests > 0) {
        this.maxConcurrentDatasourceRequests = this.datasource.maxConcurrentRequests;
    } else {
        this.maxConcurrentDatasourceRequests = 2;
    }

    // the number of pages to keep in browser cache
    if (typeof this.datasource.maxPagesInCache === 'number' && this.datasource.maxPagesInCache > 0) {
        this.maxPagesInCache = this.datasource.maxPagesInCache;
    } else {
        // null is default, means don't  have any max size on the cache
        this.maxPagesInCache = null;
    }

    this.pageSize = this.datasource.pageSize; // take a copy of page size, we don't want it changing
    this.overflowSize = this.datasource.overflowSize; // take a copy of page size, we don't want it changing

    this.doLoadOrQueue(0);
};

VirtualPageRowController.prototype.createNodesFromRows = function(pageNumber, rows) {
    var nodes = [];
    if (rows) {
        for (var i = 0, j = rows.length; i < j; i++) {
            var virtualRowIndex = (pageNumber * this.pageSize) + i;
            nodes.push({
                data: rows[i],
                id: virtualRowIndex
            });
        }
    }
    return nodes;
};

VirtualPageRowController.prototype.removeFromLoading = function(pageNumber) {
    var index = this.pageLoadsInProgress.indexOf(pageNumber);
    this.pageLoadsInProgress.splice(index, 1);
};

VirtualPageRowController.prototype.pageLoadFailed = function(pageNumber) {
    this.removeFromLoading(pageNumber);
    this.checkQueueForNextLoad();
};

VirtualPageRowController.prototype.pageLoaded = function(pageNumber, rows, lastRow) {
    this.putPageIntoCacheAndPurge(pageNumber, rows);
    this.checkMaxRowAndInformRowRenderer(pageNumber, lastRow);
    this.removeFromLoading(pageNumber);
    this.checkQueueForNextLoad();
};

VirtualPageRowController.prototype.putPageIntoCacheAndPurge = function(pageNumber, rows) {
    this.pageCache[pageNumber] = this.createNodesFromRows(pageNumber, rows);
    this.pageCacheSize++;
    if (logging) {
        console.log('adding page ' + pageNumber);
    }

    var needToPurge = this.maxPagesInCache && this.maxPagesInCache < this.pageCacheSize;
    if (needToPurge) {
        // find the LRU page
        var youngestPageIndex = this.findLeastRecentlyAccessedPage(Object.keys(this.pageCache));

        if (logging) {
            console.log('purging page ' + youngestPageIndex + ' from cache ' + Object.keys(this.pageCache));
        }
        delete this.pageCache[youngestPageIndex];
        this.pageCacheSize--;
    }

};

VirtualPageRowController.prototype.checkMaxRowAndInformRowRenderer = function(pageNumber, lastRow) {
    if (!this.foundMaxRow) {
        // if we know the last row, use if
        if (typeof lastRow === 'number' && lastRow >= 0) {
            this.virtualRowCount = lastRow;
            this.foundMaxRow = true;
        } else {
            // otherwise, see if we need to add some virtual rows
            var thisPagePlusBuffer = ((pageNumber + 1) * this.pageSize) + this.overflowSize;
            if (this.virtualRowCount < thisPagePlusBuffer) {
                this.virtualRowCount = thisPagePlusBuffer;
            }
        }
        // if rowCount changes, refreshView, otherwise just refreshAllVirtualRows
        this.rowRenderer.refreshView();
    } else {
        this.rowRenderer.refreshAllVirtualRows();
    }
};

VirtualPageRowController.prototype.isPageAlreadyLoading = function(pageNumber) {
    var result = this.pageLoadsInProgress.indexOf(pageNumber) >= 0 || this.pageLoadsQueued.indexOf(pageNumber) >= 0;
    return result;
};

VirtualPageRowController.prototype.doLoadOrQueue = function(pageNumber) {
    // if we already tried to load this page, then ignore the request,
    // otherwise server would be hit 50 times just to display one page, the
    // first row to find the page missing is enough.
    if (this.isPageAlreadyLoading(pageNumber)) {
        return;
    }

    // try the page load - if not already doing a load, then we can go ahead
    if (this.pageLoadsInProgress.length < this.maxConcurrentDatasourceRequests) {
        // go ahead, load the page
        this.loadPage(pageNumber);
    } else {
        // otherwise, queue the request
        this.addToQueueAndPurgeQueue(pageNumber);
    }
};

VirtualPageRowController.prototype.addToQueueAndPurgeQueue = function(pageNumber) {
    if (logging) {
        console.log('queueing ' + pageNumber + ' - ' + this.pageLoadsQueued);
    }
    this.pageLoadsQueued.push(pageNumber);

    // see if there are more pages queued that are actually in our cache, if so there is
    // no point in loading them all as some will be purged as soon as loaded
    var needToPurge = this.maxPagesInCache && this.maxPagesInCache < this.pageLoadsQueued.length;
    if (needToPurge) {
        // find the LRU page
        var youngestPageIndex = this.findLeastRecentlyAccessedPage(this.pageLoadsQueued);

        if (logging) {
            console.log('de-queueing ' + pageNumber + ' - ' + this.pageLoadsQueued);
        }

        var indexToRemove = this.pageLoadsQueued.indexOf(youngestPageIndex);
        this.pageLoadsQueued.splice(indexToRemove, 1);
    }
};

VirtualPageRowController.prototype.findLeastRecentlyAccessedPage = function(pageIndexes) {
    var youngestPageIndex = -1;
    var youngestPageAccessTime = Number.MAX_VALUE;
    var that = this;

    pageIndexes.forEach(function(pageIndex) {
        var accessTimeThisPage = that.pageAccessTimes[pageIndex];
        if (accessTimeThisPage < youngestPageAccessTime) {
            youngestPageAccessTime = accessTimeThisPage;
            youngestPageIndex = pageIndex;
        }
    });

    return youngestPageIndex;
};

VirtualPageRowController.prototype.checkQueueForNextLoad = function() {
    if (this.pageLoadsQueued.length > 0) {
        // take from the front of the queue
        var pageToLoad = this.pageLoadsQueued[0];
        this.pageLoadsQueued.splice(0, 1);

        if (logging) {
            console.log('dequeueing ' + pageToLoad + ' - ' + this.pageLoadsQueued);
        }

        this.loadPage(pageToLoad);
    }
};

VirtualPageRowController.prototype.loadPage = function(pageNumber) {

    this.pageLoadsInProgress.push(pageNumber);

    var startRow = pageNumber * this.pageSize;
    var endRow = (pageNumber + 1) * this.pageSize;

    var that = this;
    var datasourceVersionCopy = this.datasourceVersion;

    this.datasource.getRows(startRow, endRow,
        function success(rows, lastRow) {
            if (that.requestIsDaemon(datasourceVersionCopy)) {
                return;
            }
            that.pageLoaded(pageNumber, rows, lastRow);
        },
        function fail() {
            if (that.requestIsDaemon(datasourceVersionCopy)) {
                return;
            }
            that.pageLoadFailed(pageNumber);
        }
    );
};

// check that the datasource has not changed since the lats time we did a request
VirtualPageRowController.prototype.requestIsDaemon = function(datasourceVersionCopy) {
    return this.datasourceVersion !== datasourceVersionCopy;
};

VirtualPageRowController.prototype.getVirtualRow = function(rowIndex) {
    if (rowIndex > this.virtualRowCount) {
        return null;
    }

    var pageNumber = Math.floor(rowIndex / this.pageSize);
    var page = this.pageCache[pageNumber];

    // for LRU cache, track when this page was last hit
    this.pageAccessTimes[pageNumber] = this.accessTime++;

    if (!page) {
        this.doLoadOrQueue(pageNumber);
        // return back an empty row, so table can at least render empty cells
        return {
            data: {},
            id: rowIndex
        };
    } else {
        var indexInThisPage = rowIndex % this.pageSize;
        return page[indexInThisPage];
    }
};

VirtualPageRowController.prototype.getModel = function() {
    var that = this;
    return {
        getVirtualRow: function(index) {
            return that.getVirtualRow(index);
        },
        getVirtualRowCount: function() {
            return that.virtualRowCount;
        }
    };
};

module.exports = VirtualPageRowController;

},{}]},{},[1])
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvanMvbWFpbi5qcyIsInNyYy9qcy9jb2x1bW5Db250cm9sbGVyLmpzIiwic3JjL2pzL2NvbnN0YW50cy5qcyIsInNyYy9qcy9maWx0ZXIvZmlsdGVyTWFuYWdlci5qcyIsInNyYy9qcy9maWx0ZXIvbnVtYmVyRmlsdGVyLmpzIiwic3JjL2pzL2ZpbHRlci9udW1iZXJGaWx0ZXJUZW1wbGF0ZS5qcyIsInNyYy9qcy9maWx0ZXIvc2V0RmlsdGVyLmpzIiwic3JjL2pzL2ZpbHRlci9zZXRGaWx0ZXJNb2RlbC5qcyIsInNyYy9qcy9maWx0ZXIvc2V0RmlsdGVyVGVtcGxhdGUuanMiLCJzcmMvanMvZmlsdGVyL3RleHRGaWx0ZXIuanMiLCJzcmMvanMvZmlsdGVyL3RleHRGaWx0ZXJUZW1wbGF0ZS5qcyIsInNyYy9qcy9ncmlkLmpzIiwic3JjL2pzL2dyaWRPcHRpb25zV3JhcHBlci5qcyIsInNyYy9qcy9ncm91cENyZWF0b3IuanMiLCJzcmMvanMvaGVhZGVyUmVuZGVyZXIuanMiLCJzcmMvanMvaW5NZW1vcnlSb3dDb250cm9sbGVyLmpzIiwic3JjL2pzL3BhZ2luYXRpb25Db250cm9sbGVyLmpzIiwic3JjL2pzL3Jvd1JlbmRlcmVyLmpzIiwic3JjL2pzL3NlbGVjdGlvbkNvbnRyb2xsZXIuanMiLCJzcmMvanMvc2VsZWN0aW9uUmVuZGVyZXJGYWN0b3J5LmpzIiwic3JjL2pzL3N2Z0ZhY3RvcnkuanMiLCJzcmMvanMvdGVtcGxhdGUuanMiLCJzcmMvanMvdGVtcGxhdGVOb1Njcm9sbHMuanMiLCJzcmMvanMvdXRpbHMuanMiLCJzcmMvanMvdmlydHVhbFBhZ2VSb3dDb250cm9sbGVyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaFRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNkQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoTUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6UEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RJQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuakJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbExBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZkQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMVpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbk5BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2w2QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdFlBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiLy8gQW5ndWxhciBHcmlkXHJcbi8vIFdyaXR0ZW4gYnkgTmlhbGwgQ3Jvc2J5XHJcbi8vIHd3dy5hbmd1bGFyZ3JpZC5jb21cclxuXHJcblxyXG4oZnVuY3Rpb24oKSB7XHJcblxyXG4gICAgLy8gRXN0YWJsaXNoIHRoZSByb290IG9iamVjdCwgYHdpbmRvd2Agb3IgYGV4cG9ydHNgXHJcbiAgICB2YXIgcm9vdCA9IHRoaXM7XHJcbiAgICB2YXIgR3JpZCA9IHJlcXVpcmUoJy4vZ3JpZCcpO1xyXG5cclxuICAgIC8vIGlmIGFuZ3VsYXIgaXMgcHJlc2VudCwgcmVnaXN0ZXIgdGhlIGRpcmVjdGl2ZVxyXG4gICAgaWYgKHR5cGVvZiBhbmd1bGFyICE9PSAndW5kZWZpbmVkJykge1xyXG4gICAgICAgIHZhciBhbmd1bGFyTW9kdWxlID0gYW5ndWxhci5tb2R1bGUoXCJhbmd1bGFyR3JpZFwiLCBbXSk7XHJcbiAgICAgICAgYW5ndWxhck1vZHVsZS5kaXJlY3RpdmUoXCJhbmd1bGFyR3JpZFwiLCBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgIHJlc3RyaWN0OiBcIkFcIixcclxuICAgICAgICAgICAgICAgIGNvbnRyb2xsZXI6IFsnJGVsZW1lbnQnLCAnJHNjb3BlJywgJyRjb21waWxlJywgQW5ndWxhckRpcmVjdGl2ZUNvbnRyb2xsZXJdLFxyXG4gICAgICAgICAgICAgICAgc2NvcGU6IHtcclxuICAgICAgICAgICAgICAgICAgICBhbmd1bGFyR3JpZDogXCI9XCJcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfTtcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAodHlwZW9mIGV4cG9ydHMgIT09ICd1bmRlZmluZWQnKSB7XHJcbiAgICAgICAgaWYgKHR5cGVvZiBtb2R1bGUgIT09ICd1bmRlZmluZWQnICYmIG1vZHVsZS5leHBvcnRzKSB7XHJcbiAgICAgICAgICAgIGV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0cyA9IGFuZ3VsYXJHcmlkR2xvYmFsRnVuY3Rpb247XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGV4cG9ydHMuYW5ndWxhckdyaWQgPSBhbmd1bGFyR3JpZEdsb2JhbEZ1bmN0aW9uO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICByb290LmFuZ3VsYXJHcmlkID0gYW5ndWxhckdyaWRHbG9iYWxGdW5jdGlvbjtcclxuICAgIH1cclxuXHJcblxyXG4gICAgZnVuY3Rpb24gQW5ndWxhckRpcmVjdGl2ZUNvbnRyb2xsZXIoJGVsZW1lbnQsICRzY29wZSwgJGNvbXBpbGUpIHtcclxuICAgICAgICB2YXIgZUdyaWREaXYgPSAkZWxlbWVudFswXTtcclxuICAgICAgICB2YXIgZ3JpZE9wdGlvbnMgPSAkc2NvcGUuYW5ndWxhckdyaWQ7XHJcbiAgICAgICAgaWYgKCFncmlkT3B0aW9ucykge1xyXG4gICAgICAgICAgICBjb25zb2xlLndhcm4oXCJXQVJOSU5HIC0gZ3JpZCBvcHRpb25zIGZvciBBbmd1bGFyIEdyaWQgbm90IGZvdW5kLiBQbGVhc2UgZW5zdXJlIHRoZSBhdHRyaWJ1dGUgYW5ndWxhci1ncmlkIHBvaW50cyB0byBhIHZhbGlkIG9iamVjdCBvbiB0aGUgc2NvcGVcIik7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgdmFyIGdyaWQgPSBuZXcgR3JpZChlR3JpZERpdiwgZ3JpZE9wdGlvbnMsICRzY29wZSwgJGNvbXBpbGUpO1xyXG5cclxuICAgICAgICAkc2NvcGUuJG9uKFwiJGRlc3Ryb3lcIiwgZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIGdyaWQuc2V0RmluaXNoZWQoKTtcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBHbG9iYWwgRnVuY3Rpb24gLSB0aGlzIGZ1bmN0aW9uIGlzIHVzZWQgZm9yIGNyZWF0aW5nIGEgZ3JpZCwgb3V0c2lkZSBvZiBhbnkgQW5ndWxhckpTXHJcbiAgICBmdW5jdGlvbiBhbmd1bGFyR3JpZEdsb2JhbEZ1bmN0aW9uKGVsZW1lbnQsIGdyaWRPcHRpb25zKSB7XHJcbiAgICAgICAgLy8gc2VlIGlmIGVsZW1lbnQgaXMgYSBxdWVyeSBzZWxlY3Rvciwgb3IgYSByZWFsIGVsZW1lbnRcclxuICAgICAgICB2YXIgZUdyaWREaXY7XHJcbiAgICAgICAgaWYgKHR5cGVvZiBlbGVtZW50ID09PSAnc3RyaW5nJykge1xyXG4gICAgICAgICAgICBlR3JpZERpdiA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoZWxlbWVudCk7XHJcbiAgICAgICAgICAgIGlmICghZUdyaWREaXYpIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdXQVJOSU5HIC0gd2FzIG5vdCBhYmxlIHRvIGZpbmQgZWxlbWVudCAnICsgZWxlbWVudCArICcgaW4gdGhlIERPTSwgQW5ndWxhciBHcmlkIGluaXRpYWxpc2F0aW9uIGFib3J0ZWQuJyk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBlR3JpZERpdiA9IGVsZW1lbnQ7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIG5ldyBHcmlkKGVHcmlkRGl2LCBncmlkT3B0aW9ucywgbnVsbCwgbnVsbCk7XHJcbiAgICB9XHJcblxyXG59KS5jYWxsKHRoaXMpO1xyXG4iLCJ2YXIgY29uc3RhbnRzID0gcmVxdWlyZSgnLi9jb25zdGFudHMnKTtcclxuXHJcbmZ1bmN0aW9uIENvbHVtbkNvbnRyb2xsZXIoKSB7XHJcbiAgICB0aGlzLmNyZWF0ZU1vZGVsKCk7XHJcbn1cclxuXHJcbkNvbHVtbkNvbnRyb2xsZXIucHJvdG90eXBlLmluaXQgPSBmdW5jdGlvbihhbmd1bGFyR3JpZCwgc2VsZWN0aW9uUmVuZGVyZXJGYWN0b3J5LCBncmlkT3B0aW9uc1dyYXBwZXIpIHtcclxuICAgIHRoaXMuZ3JpZE9wdGlvbnNXcmFwcGVyID0gZ3JpZE9wdGlvbnNXcmFwcGVyO1xyXG4gICAgdGhpcy5hbmd1bGFyR3JpZCA9IGFuZ3VsYXJHcmlkO1xyXG4gICAgdGhpcy5zZWxlY3Rpb25SZW5kZXJlckZhY3RvcnkgPSBzZWxlY3Rpb25SZW5kZXJlckZhY3Rvcnk7XHJcbn07XHJcblxyXG5Db2x1bW5Db250cm9sbGVyLnByb3RvdHlwZS5jcmVhdGVNb2RlbCA9IGZ1bmN0aW9uKCkge1xyXG4gICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgdGhpcy5tb2RlbCA9IHtcclxuICAgICAgICAvLyB1c2VkIGJ5OlxyXG4gICAgICAgIC8vICsgaW5NZW1vcnlSb3dDb250cm9sbGVyIC0+IHNvcnRpbmcsIGJ1aWxkaW5nIHF1aWNrIGZpbHRlciB0ZXh0XHJcbiAgICAgICAgLy8gKyBoZWFkZXJSZW5kZXJlciAtPiBzb3J0aW5nIChjbGVhcmluZyBpY29uKVxyXG4gICAgICAgIGdldEFsbENvbHVtbnM6IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICByZXR1cm4gdGhhdC5jb2x1bW5zO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgLy8gKyByb3dDb250cm9sbGVyIC0+IHdoaWxlIGluc2VydGluZyByb3dzLCBhbmQgd2hlbiB0YWJiaW5nIHRocm91Z2ggY2VsbHMgKG5lZWQgdG8gY2hhbmdlIHRoaXMpXHJcbiAgICAgICAgLy8gbmVlZCBhIG5ld01ldGhvZCAtIGdldCBuZXh0IGNvbCBpbmRleFxyXG4gICAgICAgIGdldFZpc2libGVDb2x1bW5zOiBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRoYXQudmlzaWJsZUNvbHVtbnM7XHJcbiAgICAgICAgfSxcclxuICAgICAgICAvLyB1c2VkIGJ5OlxyXG4gICAgICAgIC8vICsgYW5ndWxhckdyaWQgLT4gZm9yIHNldHRpbmcgYm9keSB3aWR0aFxyXG4gICAgICAgIC8vICsgcm93Q29udHJvbGxlciAtPiBzZXR0aW5nIG1haW4gcm93IHdpZHRocyAod2hlbiBpbnNlcnRpbmcgYW5kIHJlc2l6aW5nKVxyXG4gICAgICAgIGdldEJvZHlDb250YWluZXJXaWR0aDogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGF0LmdldFRvdGFsQ29sV2lkdGgoZmFsc2UpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgLy8gdXNlZCBieTpcclxuICAgICAgICAvLyArIGFuZ3VsYXJHcmlkIC0+IHNldHRpbmcgcGlubmVkIGJvZHkgd2lkdGhcclxuICAgICAgICBnZXRQaW5uZWRDb250YWluZXJXaWR0aDogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGF0LmdldFRvdGFsQ29sV2lkdGgodHJ1ZSk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICAvLyB1c2VkIGJ5OlxyXG4gICAgICAgIC8vICsgaGVhZGVyUmVuZGVyZXIgLT4gc2V0dGluZyBwaW5uZWQgYm9keSB3aWR0aFxyXG4gICAgICAgIGdldENvbHVtbkdyb3VwczogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGF0LmNvbHVtbkdyb3VwcztcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG59O1xyXG5cclxuQ29sdW1uQ29udHJvbGxlci5wcm90b3R5cGUuZ2V0TW9kZWwgPSBmdW5jdGlvbigpIHtcclxuICAgIHJldHVybiB0aGlzLm1vZGVsO1xyXG59O1xyXG5cclxuLy8gY2FsbGVkIGJ5IGFuZ3VsYXJHcmlkXHJcbkNvbHVtbkNvbnRyb2xsZXIucHJvdG90eXBlLnNldENvbHVtbnMgPSBmdW5jdGlvbihjb2x1bW5EZWZzKSB7XHJcbiAgICB0aGlzLmJ1aWxkQ29sdW1ucyhjb2x1bW5EZWZzKTtcclxuICAgIHRoaXMuZW5zdXJlRWFjaENvbEhhc1NpemUoKTtcclxuICAgIHRoaXMuYnVpbGRHcm91cHMoKTtcclxuICAgIHRoaXMudXBkYXRlR3JvdXBzKCk7XHJcbiAgICB0aGlzLnVwZGF0ZVZpc2libGVDb2x1bW5zKCk7XHJcbn07XHJcblxyXG4vLyBjYWxsZWQgYnkgaGVhZGVyUmVuZGVyZXIgLSB3aGVuIGEgaGVhZGVyIGlzIG9wZW5lZCBvciBjbG9zZWRcclxuQ29sdW1uQ29udHJvbGxlci5wcm90b3R5cGUuY29sdW1uR3JvdXBPcGVuZWQgPSBmdW5jdGlvbihncm91cCkge1xyXG4gICAgZ3JvdXAuZXhwYW5kZWQgPSAhZ3JvdXAuZXhwYW5kZWQ7XHJcbiAgICB0aGlzLnVwZGF0ZUdyb3VwcygpO1xyXG4gICAgdGhpcy51cGRhdGVWaXNpYmxlQ29sdW1ucygpO1xyXG4gICAgdGhpcy5hbmd1bGFyR3JpZC5yZWZyZXNoSGVhZGVyQW5kQm9keSgpO1xyXG59O1xyXG5cclxuLy8gcHJpdmF0ZVxyXG5Db2x1bW5Db250cm9sbGVyLnByb3RvdHlwZS51cGRhdGVWaXNpYmxlQ29sdW1ucyA9IGZ1bmN0aW9uKCkge1xyXG4gICAgLy8gaWYgbm90IGdyb3VwaW5nIGJ5IGhlYWRlcnMsIHRoZW4gYWxsIGNvbHVtbnMgYXJlIHZpc2libGVcclxuICAgIGlmICghdGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuaXNHcm91cEhlYWRlcnMoKSkge1xyXG4gICAgICAgIHRoaXMudmlzaWJsZUNvbHVtbnMgPSB0aGlzLmNvbHVtbnM7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIGlmIGdyb3VwaW5nLCB0aGVuIG9ubHkgc2hvdyBjb2wgYXMgcGVyIGdyb3VwIHJ1bGVzXHJcbiAgICB0aGlzLnZpc2libGVDb2x1bW5zID0gW107XHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMuY29sdW1uR3JvdXBzLmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgdmFyIGdyb3VwID0gdGhpcy5jb2x1bW5Hcm91cHNbaV07XHJcbiAgICAgICAgZ3JvdXAuYWRkVG9WaXNpYmxlQ29sdW1ucyh0aGlzLnZpc2libGVDb2x1bW5zKTtcclxuICAgIH1cclxufTtcclxuXHJcbi8vIHB1YmxpYyAtIGNhbGxlZCBmcm9tIGFwaVxyXG5Db2x1bW5Db250cm9sbGVyLnByb3RvdHlwZS5zaXplQ29sdW1uc1RvRml0ID0gZnVuY3Rpb24oYXZhaWxhYmxlV2lkdGgpIHtcclxuICAgIC8vIGF2b2lkIGRpdmlkZSBieSB6ZXJvXHJcbiAgICBpZiAoYXZhaWxhYmxlV2lkdGggPD0gMCB8fCB0aGlzLnZpc2libGVDb2x1bW5zLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICB2YXIgY3VycmVudFRvdGFsV2lkdGggPSB0aGlzLmdldFRvdGFsQ29sV2lkdGgoKTtcclxuICAgIHZhciBzY2FsZSA9IGF2YWlsYWJsZVdpZHRoIC8gY3VycmVudFRvdGFsV2lkdGg7XHJcblxyXG4gICAgLy8gc2l6ZSBhbGwgY29scyBleGNlcHQgdGhlIGxhc3QgYnkgdGhlIHNjYWxlXHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8ICh0aGlzLnZpc2libGVDb2x1bW5zLmxlbmd0aCAtIDEpOyBpKyspIHtcclxuICAgICAgICB2YXIgY29sdW1uID0gdGhpcy52aXNpYmxlQ29sdW1uc1tpXTtcclxuICAgICAgICB2YXIgbmV3V2lkdGggPSBwYXJzZUludChjb2x1bW4uYWN0dWFsV2lkdGggKiBzY2FsZSk7XHJcbiAgICAgICAgY29sdW1uLmFjdHVhbFdpZHRoID0gbmV3V2lkdGg7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gc2l6ZSB0aGUgbGFzdCBieSB3aGF0cyByZW1haW5pbmcgKHRoaXMgYXZvaWRzIHJvdW5kaW5nIGVycm9ycyB0aGF0IGNvdWxkXHJcbiAgICAvLyBvY2N1ciB3aXRoIHNjYWxpbmcgZXZlcnl0aGluZywgd2hlcmUgaXQgcmVzdWx0IGluIHNvbWUgcGl4ZWxzIG9mZilcclxuICAgIHZhciBwaXhlbHNMZWZ0Rm9yTGFzdENvbCA9IGF2YWlsYWJsZVdpZHRoIC0gdGhpcy5nZXRUb3RhbENvbFdpZHRoKCk7XHJcbiAgICB2YXIgbGFzdENvbHVtbiA9IHRoaXMudmlzaWJsZUNvbHVtbnNbdGhpcy52aXNpYmxlQ29sdW1ucy5sZW5ndGggLSAxXTtcclxuICAgIGxhc3RDb2x1bW4uYWN0dWFsV2lkdGggKz0gcGl4ZWxzTGVmdEZvckxhc3RDb2w7XHJcblxyXG4gICAgLy8gd2lkdGhzIHNldCwgcmVmcmVzaCB0aGUgZ3VpXHJcbiAgICB0aGlzLmFuZ3VsYXJHcmlkLnJlZnJlc2hIZWFkZXJBbmRCb2R5KCk7XHJcbn07XHJcblxyXG4vLyBwcml2YXRlXHJcbkNvbHVtbkNvbnRyb2xsZXIucHJvdG90eXBlLmJ1aWxkR3JvdXBzID0gZnVuY3Rpb24oKSB7XHJcbiAgICAvLyBpZiBub3QgZ3JvdXBpbmcgYnkgaGVhZGVycywgZG8gbm90aGluZ1xyXG4gICAgaWYgKCF0aGlzLmdyaWRPcHRpb25zV3JhcHBlci5pc0dyb3VwSGVhZGVycygpKSB7XHJcbiAgICAgICAgdGhpcy5jb2x1bW5Hcm91cHMgPSBudWxsO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICAvLyBzcGxpdCB0aGUgY29sdW1ucyBpbnRvIGdyb3Vwc1xyXG4gICAgdmFyIGN1cnJlbnRHcm91cCA9IG51bGw7XHJcbiAgICB0aGlzLmNvbHVtbkdyb3VwcyA9IFtdO1xyXG4gICAgdmFyIHRoYXQgPSB0aGlzO1xyXG5cclxuICAgIHZhciBsYXN0Q29sV2FzUGlubmVkID0gdHJ1ZTtcclxuXHJcbiAgICB0aGlzLmNvbHVtbnMuZm9yRWFjaChmdW5jdGlvbihjb2x1bW4pIHtcclxuICAgICAgICAvLyBkbyB3ZSBuZWVkIGEgbmV3IGdyb3VwLCBiZWNhdXNlIHdlIG1vdmUgZnJvbSBwaW5uZWQgdG8gbm9uLXBpbm5lZCBjb2x1bW5zP1xyXG4gICAgICAgIHZhciBlbmRPZlBpbm5lZEhlYWRlciA9IGxhc3RDb2xXYXNQaW5uZWQgJiYgIWNvbHVtbi5waW5uZWQ7XHJcbiAgICAgICAgaWYgKCFjb2x1bW4ucGlubmVkKSB7XHJcbiAgICAgICAgICAgIGxhc3RDb2xXYXNQaW5uZWQgPSBmYWxzZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgLy8gZG8gd2UgbmVlZCBhIG5ldyBncm91cCwgYmVjYXVzZSB0aGUgZ3JvdXAgbmFtZXMgZG9lc24ndCBtYXRjaCBmcm9tIHByZXZpb3VzIGNvbD9cclxuICAgICAgICB2YXIgZ3JvdXBLZXlNaXNtYXRjaCA9IGN1cnJlbnRHcm91cCAmJiBjb2x1bW4uY29sRGVmLmdyb3VwICE9PSBjdXJyZW50R3JvdXAubmFtZTtcclxuICAgICAgICAvLyB3ZSBkb24ndCBncm91cCBjb2x1bW5zIHdoZXJlIG5vIGdyb3VwIGlzIHNwZWNpZmllZFxyXG4gICAgICAgIHZhciBjb2xOb3RJbkdyb3VwID0gY3VycmVudEdyb3VwICYmICFjdXJyZW50R3JvdXAubmFtZTtcclxuICAgICAgICAvLyBkbyB3ZSBuZWVkIGEgbmV3IGdyb3VwLCBiZWNhdXNlIHdlIGFyZSBqdXN0IHN0YXJ0aW5nXHJcbiAgICAgICAgdmFyIHByb2Nlc3NpbmdGaXJzdENvbCA9IGNvbHVtbi5pbmRleCA9PT0gMDtcclxuICAgICAgICB2YXIgbmV3R3JvdXBOZWVkZWQgPSBwcm9jZXNzaW5nRmlyc3RDb2wgfHwgZW5kT2ZQaW5uZWRIZWFkZXIgfHwgZ3JvdXBLZXlNaXNtYXRjaCB8fCBjb2xOb3RJbkdyb3VwO1xyXG4gICAgICAgIC8vIGNyZWF0ZSBuZXcgZ3JvdXAsIGlmIGl0J3MgbmVlZGVkXHJcbiAgICAgICAgaWYgKG5ld0dyb3VwTmVlZGVkKSB7XHJcbiAgICAgICAgICAgIHZhciBwaW5uZWQgPSBjb2x1bW4ucGlubmVkO1xyXG4gICAgICAgICAgICBjdXJyZW50R3JvdXAgPSBuZXcgQ29sdW1uR3JvdXAocGlubmVkLCBjb2x1bW4uY29sRGVmLmdyb3VwKTtcclxuICAgICAgICAgICAgdGhhdC5jb2x1bW5Hcm91cHMucHVzaChjdXJyZW50R3JvdXApO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjdXJyZW50R3JvdXAuYWRkQ29sdW1uKGNvbHVtbik7XHJcbiAgICB9KTtcclxufTtcclxuXHJcbi8vIHByaXZhdGVcclxuQ29sdW1uQ29udHJvbGxlci5wcm90b3R5cGUudXBkYXRlR3JvdXBzID0gZnVuY3Rpb24oKSB7XHJcbiAgICAvLyBpZiBub3QgZ3JvdXBpbmcgYnkgaGVhZGVycywgZG8gbm90aGluZ1xyXG4gICAgaWYgKCF0aGlzLmdyaWRPcHRpb25zV3JhcHBlci5pc0dyb3VwSGVhZGVycygpKSB7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy5jb2x1bW5Hcm91cHMubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICB2YXIgZ3JvdXAgPSB0aGlzLmNvbHVtbkdyb3Vwc1tpXTtcclxuICAgICAgICBncm91cC5jYWxjdWxhdGVFeHBhbmRhYmxlKCk7XHJcbiAgICAgICAgZ3JvdXAuY2FsY3VsYXRlVmlzaWJsZUNvbHVtbnMoKTtcclxuICAgIH1cclxufTtcclxuXHJcbi8vIHByaXZhdGVcclxuQ29sdW1uQ29udHJvbGxlci5wcm90b3R5cGUuYnVpbGRDb2x1bW5zID0gZnVuY3Rpb24oY29sdW1uRGVmcykge1xyXG4gICAgdGhpcy5jb2x1bW5zID0gW107XHJcbiAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICB2YXIgcGlubmVkQ29sdW1uQ291bnQgPSB0aGlzLmdyaWRPcHRpb25zV3JhcHBlci5nZXRQaW5uZWRDb2xDb3VudCgpO1xyXG4gICAgaWYgKGNvbHVtbkRlZnMpIHtcclxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGNvbHVtbkRlZnMubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICAgICAgdmFyIGNvbERlZiA9IGNvbHVtbkRlZnNbaV07XHJcbiAgICAgICAgICAgIC8vIHRoaXMgaXMgbWVzc3kgLSB3ZSBzd2FwIGluIGFub3RoZXIgY29sIGRlZiBpZiBpdCdzIGNoZWNrYm94IHNlbGVjdGlvbiAtIG5vdCBoYXBweSA6KFxyXG4gICAgICAgICAgICBpZiAoY29sRGVmID09PSAnY2hlY2tib3hTZWxlY3Rpb24nKSB7XHJcbiAgICAgICAgICAgICAgICBjb2xEZWYgPSB0aGF0LnNlbGVjdGlvblJlbmRlcmVyRmFjdG9yeS5jcmVhdGVDaGVja2JveENvbERlZigpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHZhciBwaW5uZWQgPSBwaW5uZWRDb2x1bW5Db3VudCA+IGk7XHJcbiAgICAgICAgICAgIHZhciBjb2x1bW4gPSBuZXcgQ29sdW1uKGNvbERlZiwgaSwgcGlubmVkKTtcclxuICAgICAgICAgICAgdGhhdC5jb2x1bW5zLnB1c2goY29sdW1uKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbn07XHJcblxyXG4vLyBwcml2YXRlXHJcbi8vIHNldCB0aGUgYWN0dWFsIHdpZHRocyBmb3IgZWFjaCBjb2xcclxuQ29sdW1uQ29udHJvbGxlci5wcm90b3R5cGUuZW5zdXJlRWFjaENvbEhhc1NpemUgPSBmdW5jdGlvbigpIHtcclxuICAgIHRoaXMuY29sdW1ucy5mb3JFYWNoKGZ1bmN0aW9uKGNvbERlZldyYXBwZXIpIHtcclxuICAgICAgICB2YXIgY29sRGVmID0gY29sRGVmV3JhcHBlci5jb2xEZWY7XHJcbiAgICAgICAgaWYgKGNvbERlZldyYXBwZXIuYWN0dWFsV2lkdGgpIHtcclxuICAgICAgICAgICAgLy8gaWYgYWN0dWFsIHdpZHRoIGFscmVhZHkgc2V0LCBkbyBub3RoaW5nXHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9IGVsc2UgaWYgKCFjb2xEZWYud2lkdGgpIHtcclxuICAgICAgICAgICAgLy8gaWYgbm8gd2lkdGggZGVmaW5lZCBpbiBjb2xEZWYsIGRlZmF1bHQgdG8gMjAwXHJcbiAgICAgICAgICAgIGNvbERlZldyYXBwZXIuYWN0dWFsV2lkdGggPSAyMDA7XHJcbiAgICAgICAgfSBlbHNlIGlmIChjb2xEZWYud2lkdGggPCBjb25zdGFudHMuTUlOX0NPTF9XSURUSCkge1xyXG4gICAgICAgICAgICAvLyBpZiB3aWR0aCBpbiBjb2wgZGVmIHRvIHNtYWxsLCBzZXQgdG8gbWluIHdpZHRoXHJcbiAgICAgICAgICAgIGNvbERlZldyYXBwZXIuYWN0dWFsV2lkdGggPSBjb25zdGFudHMuTUlOX0NPTF9XSURUSDtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAvLyBvdGhlcndpc2UgdXNlIHRoZSBwcm92aWRlZCB3aWR0aFxyXG4gICAgICAgICAgICBjb2xEZWZXcmFwcGVyLmFjdHVhbFdpZHRoID0gY29sRGVmLndpZHRoO1xyXG4gICAgICAgIH1cclxuICAgIH0pO1xyXG59O1xyXG5cclxuLy8gcHJpdmF0ZVxyXG4vLyBjYWxsIHdpdGggdHJ1ZSAocGlubmVkKSwgZmFsc2UgKG5vdC1waW5uZWQpIG9yIHVuZGVmaW5lZCAoYWxsIGNvbHVtbnMpXHJcbkNvbHVtbkNvbnRyb2xsZXIucHJvdG90eXBlLmdldFRvdGFsQ29sV2lkdGggPSBmdW5jdGlvbihpbmNsdWRlUGlubmVkKSB7XHJcbiAgICB2YXIgd2lkdGhTb0ZhciA9IDA7XHJcbiAgICB2YXIgcGluZWROb3RJbXBvcnRhbnQgPSB0eXBlb2YgaW5jbHVkZVBpbm5lZCAhPT0gJ2Jvb2xlYW4nO1xyXG5cclxuICAgIHRoaXMudmlzaWJsZUNvbHVtbnMuZm9yRWFjaChmdW5jdGlvbihjb2x1bW4pIHtcclxuICAgICAgICB2YXIgaW5jbHVkZVRoaXNDb2wgPSBwaW5lZE5vdEltcG9ydGFudCB8fCBjb2x1bW4ucGlubmVkID09PSBpbmNsdWRlUGlubmVkO1xyXG4gICAgICAgIGlmIChpbmNsdWRlVGhpc0NvbCkge1xyXG4gICAgICAgICAgICB3aWR0aFNvRmFyICs9IGNvbHVtbi5hY3R1YWxXaWR0aDtcclxuICAgICAgICB9XHJcbiAgICB9KTtcclxuXHJcbiAgICByZXR1cm4gd2lkdGhTb0ZhcjtcclxufTtcclxuXHJcbmZ1bmN0aW9uIENvbHVtbkdyb3VwKHBpbm5lZCwgbmFtZSkge1xyXG4gICAgdGhpcy5waW5uZWQgPSBwaW5uZWQ7XHJcbiAgICB0aGlzLm5hbWUgPSBuYW1lO1xyXG4gICAgdGhpcy5hbGxDb2x1bW5zID0gW107XHJcbiAgICB0aGlzLnZpc2libGVDb2x1bW5zID0gW107XHJcbiAgICB0aGlzLmV4cGFuZGFibGUgPSBmYWxzZTsgLy8gd2hldGhlciB0aGlzIGdyb3VwIGNhbiBiZSBleHBhbmRlZCBvciBub3RcclxuICAgIHRoaXMuZXhwYW5kZWQgPSBmYWxzZTtcclxufVxyXG5cclxuQ29sdW1uR3JvdXAucHJvdG90eXBlLmFkZENvbHVtbiA9IGZ1bmN0aW9uKGNvbHVtbikge1xyXG4gICAgdGhpcy5hbGxDb2x1bW5zLnB1c2goY29sdW1uKTtcclxufTtcclxuXHJcbi8vIG5lZWQgdG8gY2hlY2sgdGhhdCB0aGlzIGdyb3VwIGhhcyBhdCBsZWFzdCBvbmUgY29sIHNob3dpbmcgd2hlbiBib3RoIGV4cGFuZGVkIGFuZCBjb250cmFjdGVkLlxyXG4vLyBpZiBub3QsIHRoZW4gd2UgZG9uJ3QgYWxsb3cgZXhwYW5kaW5nIGFuZCBjb250cmFjdGluZyBvbiB0aGlzIGdyb3VwXHJcbkNvbHVtbkdyb3VwLnByb3RvdHlwZS5jYWxjdWxhdGVFeHBhbmRhYmxlID0gZnVuY3Rpb24oKSB7XHJcbiAgICAvLyB3YW50IHRvIG1ha2Ugc3VyZSB0aGUgZ3JvdXAgZG9lc24ndCBkaXNhcHBlYXIgd2hlbiBpdCdzIG9wZW5cclxuICAgIHZhciBhdExlYXN0T25lU2hvd2luZ1doZW5PcGVuID0gZmFsc2U7XHJcbiAgICAvLyB3YW50IHRvIG1ha2Ugc3VyZSB0aGUgZ3JvdXAgZG9lc24ndCBkaXNhcHBlYXIgd2hlbiBpdCdzIGNsb3NlZFxyXG4gICAgdmFyIGF0TGVhc3RPbmVTaG93aW5nV2hlbkNsb3NlZCA9IGZhbHNlO1xyXG4gICAgLy8gd2FudCB0byBtYWtlIHN1cmUgdGhlIGdyb3VwIGhhcyBzb21ldGhpbmcgdG8gc2hvdyAvIGhpZGVcclxuICAgIHZhciBhdExlYXN0T25lQ2hhbmdlYWJsZSA9IGZhbHNlO1xyXG4gICAgZm9yICh2YXIgaSA9IDAsIGogPSB0aGlzLmFsbENvbHVtbnMubGVuZ3RoOyBpIDwgajsgaSsrKSB7XHJcbiAgICAgICAgdmFyIGNvbHVtbiA9IHRoaXMuYWxsQ29sdW1uc1tpXTtcclxuICAgICAgICBpZiAoY29sdW1uLmNvbERlZi5ncm91cFNob3cgPT09ICdvcGVuJykge1xyXG4gICAgICAgICAgICBhdExlYXN0T25lU2hvd2luZ1doZW5PcGVuID0gdHJ1ZTtcclxuICAgICAgICAgICAgYXRMZWFzdE9uZUNoYW5nZWFibGUgPSB0cnVlO1xyXG4gICAgICAgIH0gZWxzZSBpZiAoY29sdW1uLmNvbERlZi5ncm91cFNob3cgPT09ICdjbG9zZWQnKSB7XHJcbiAgICAgICAgICAgIGF0TGVhc3RPbmVTaG93aW5nV2hlbkNsb3NlZCA9IHRydWU7XHJcbiAgICAgICAgICAgIGF0TGVhc3RPbmVDaGFuZ2VhYmxlID0gdHJ1ZTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBhdExlYXN0T25lU2hvd2luZ1doZW5PcGVuID0gdHJ1ZTtcclxuICAgICAgICAgICAgYXRMZWFzdE9uZVNob3dpbmdXaGVuQ2xvc2VkID0gdHJ1ZTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5leHBhbmRhYmxlID0gYXRMZWFzdE9uZVNob3dpbmdXaGVuT3BlbiAmJiBhdExlYXN0T25lU2hvd2luZ1doZW5DbG9zZWQgJiYgYXRMZWFzdE9uZUNoYW5nZWFibGU7XHJcbn07XHJcblxyXG5Db2x1bW5Hcm91cC5wcm90b3R5cGUuY2FsY3VsYXRlVmlzaWJsZUNvbHVtbnMgPSBmdW5jdGlvbigpIHtcclxuICAgIC8vIGNsZWFyIG91dCBsYXN0IHRpbWUgd2UgY2FsY3VsYXRlZFxyXG4gICAgdGhpcy52aXNpYmxlQ29sdW1ucyA9IFtdO1xyXG4gICAgLy8gaXQgbm90IGV4cGFuZGFibGUsIGV2ZXJ5dGhpbmcgaXMgdmlzaWJsZVxyXG4gICAgaWYgKCF0aGlzLmV4cGFuZGFibGUpIHtcclxuICAgICAgICB0aGlzLnZpc2libGVDb2x1bW5zID0gdGhpcy5hbGxDb2x1bW5zO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIC8vIGFuZCBjYWxjdWxhdGUgYWdhaW5cclxuICAgIGZvciAodmFyIGkgPSAwLCBqID0gdGhpcy5hbGxDb2x1bW5zLmxlbmd0aDsgaSA8IGo7IGkrKykge1xyXG4gICAgICAgIHZhciBjb2x1bW4gPSB0aGlzLmFsbENvbHVtbnNbaV07XHJcbiAgICAgICAgc3dpdGNoIChjb2x1bW4uY29sRGVmLmdyb3VwU2hvdykge1xyXG4gICAgICAgICAgICBjYXNlICdvcGVuJzpcclxuICAgICAgICAgICAgICAgIC8vIHdoZW4gc2V0IHRvIG9wZW4sIG9ubHkgc2hvdyBjb2wgaWYgZ3JvdXAgaXMgb3BlblxyXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuZXhwYW5kZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLnZpc2libGVDb2x1bW5zLnB1c2goY29sdW1uKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICBjYXNlICdjbG9zZWQnOlxyXG4gICAgICAgICAgICAgICAgLy8gd2hlbiBzZXQgdG8gb3Blbiwgb25seSBzaG93IGNvbCBpZiBncm91cCBpcyBvcGVuXHJcbiAgICAgICAgICAgICAgICBpZiAoIXRoaXMuZXhwYW5kZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLnZpc2libGVDb2x1bW5zLnB1c2goY29sdW1uKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICBkZWZhdWx0OlxyXG4gICAgICAgICAgICAgICAgLy8gZGVmYXVsdCBpcyBhbHdheXMgc2hvdyB0aGUgY29sdW1uXHJcbiAgICAgICAgICAgICAgICB0aGlzLnZpc2libGVDb2x1bW5zLnB1c2goY29sdW1uKTtcclxuICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxufTtcclxuXHJcbkNvbHVtbkdyb3VwLnByb3RvdHlwZS5hZGRUb1Zpc2libGVDb2x1bW5zID0gZnVuY3Rpb24oYWxsVmlzaWJsZUNvbHVtbnMpIHtcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy52aXNpYmxlQ29sdW1ucy5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgIHZhciBjb2x1bW4gPSB0aGlzLnZpc2libGVDb2x1bW5zW2ldO1xyXG4gICAgICAgIGFsbFZpc2libGVDb2x1bW5zLnB1c2goY29sdW1uKTtcclxuICAgIH1cclxufTtcclxuXHJcbmZ1bmN0aW9uIENvbHVtbihjb2xEZWYsIGluZGV4LCBwaW5uZWQpIHtcclxuICAgIHRoaXMuY29sRGVmID0gY29sRGVmO1xyXG4gICAgdGhpcy5pbmRleCA9IGluZGV4O1xyXG4gICAgdGhpcy5waW5uZWQgPSBwaW5uZWQ7XHJcbiAgICAvLyBpbiB0aGUgZnV0dXJlLCB0aGUgY29sS2V5IG1pZ2h0IGJlIHNvbWV0aGluZyBvdGhlciB0aGFuIHRoZSBpbmRleFxyXG4gICAgdGhpcy5jb2xLZXkgPSBpbmRleDtcclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBDb2x1bW5Db250cm9sbGVyO1xyXG4iLCJ2YXIgY29uc3RhbnRzID0ge1xyXG4gICAgU1RFUF9FVkVSWVRISU5HOiAwLFxyXG4gICAgU1RFUF9GSUxURVI6IDEsXHJcbiAgICBTVEVQX1NPUlQ6IDIsXHJcbiAgICBTVEVQX01BUDogMyxcclxuICAgIEFTQzogXCJhc2NcIixcclxuICAgIERFU0M6IFwiZGVzY1wiLFxyXG4gICAgUk9XX0JVRkZFUl9TSVpFOiA1LFxyXG4gICAgU09SVF9TVFlMRV9TSE9XOiBcImRpc3BsYXk6aW5saW5lO1wiLFxyXG4gICAgU09SVF9TVFlMRV9ISURFOiBcImRpc3BsYXk6bm9uZTtcIixcclxuICAgIE1JTl9DT0xfV0lEVEg6IDEwLFxyXG59O1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBjb25zdGFudHM7XHJcbiIsInZhciB1dGlscyA9IHJlcXVpcmUoJy4vLi4vdXRpbHMnKTtcclxudmFyIFNldEZpbHRlciA9IHJlcXVpcmUoJy4vc2V0RmlsdGVyJyk7XHJcbnZhciBOdW1iZXJGaWx0ZXIgPSByZXF1aXJlKCcuL251bWJlckZpbHRlcicpO1xyXG52YXIgU3RyaW5nRmlsdGVyID0gcmVxdWlyZSgnLi90ZXh0RmlsdGVyJyk7XHJcblxyXG5mdW5jdGlvbiBGaWx0ZXJNYW5hZ2VyKCkge31cclxuXHJcbkZpbHRlck1hbmFnZXIucHJvdG90eXBlLmluaXQgPSBmdW5jdGlvbihncmlkLCBncmlkT3B0aW9uc1dyYXBwZXIsICRjb21waWxlLCAkc2NvcGUpIHtcclxuICAgIHRoaXMuJGNvbXBpbGUgPSAkY29tcGlsZTtcclxuICAgIHRoaXMuJHNjb3BlID0gJHNjb3BlO1xyXG4gICAgdGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIgPSBncmlkT3B0aW9uc1dyYXBwZXI7XHJcbiAgICB0aGlzLmdyaWQgPSBncmlkO1xyXG4gICAgdGhpcy5hbGxGaWx0ZXJzID0ge307XHJcbn07XHJcblxyXG5GaWx0ZXJNYW5hZ2VyLnByb3RvdHlwZS5zZXRSb3dNb2RlbCA9IGZ1bmN0aW9uKHJvd01vZGVsKSB7XHJcbiAgICB0aGlzLnJvd01vZGVsID0gcm93TW9kZWw7XHJcbn07XHJcblxyXG4vLyByZXR1cm5zIHRydWUgaWYgYXQgbGVhc3Qgb25lIGZpbHRlciBpcyBhY3RpdmVcclxuRmlsdGVyTWFuYWdlci5wcm90b3R5cGUuaXNGaWx0ZXJQcmVzZW50ID0gZnVuY3Rpb24oKSB7XHJcbiAgICB2YXIgYXRMZWFzdE9uZUFjdGl2ZSA9IGZhbHNlO1xyXG4gICAgdmFyIHRoYXQgPSB0aGlzO1xyXG5cclxuICAgIHZhciBrZXlzID0gT2JqZWN0LmtleXModGhpcy5hbGxGaWx0ZXJzKTtcclxuICAgIGtleXMuZm9yRWFjaChmdW5jdGlvbihrZXkpIHtcclxuICAgICAgICB2YXIgZmlsdGVyV3JhcHBlciA9IHRoYXQuYWxsRmlsdGVyc1trZXldO1xyXG4gICAgICAgIGlmICghZmlsdGVyV3JhcHBlci5maWx0ZXIuaXNGaWx0ZXJBY3RpdmUpIHsgLy8gYmVjYXVzZSB1c2VycyBjYW4gZG8gY3VzdG9tIGZpbHRlcnMsIGdpdmUgbmljZSBlcnJvciBtZXNzYWdlXHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZpbHRlciBpcyBtaXNzaW5nIG1ldGhvZCBpc0ZpbHRlckFjdGl2ZScpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoZmlsdGVyV3JhcHBlci5maWx0ZXIuaXNGaWx0ZXJBY3RpdmUoKSkge1xyXG4gICAgICAgICAgICBhdExlYXN0T25lQWN0aXZlID0gdHJ1ZTtcclxuICAgICAgICB9XHJcbiAgICB9KTtcclxuICAgIHJldHVybiBhdExlYXN0T25lQWN0aXZlO1xyXG59O1xyXG5cclxuLy8gcmV0dXJucyB0cnVlIGlmIGdpdmVuIGNvbCBoYXMgYSBmaWx0ZXIgYWN0aXZlXHJcbkZpbHRlck1hbmFnZXIucHJvdG90eXBlLmlzRmlsdGVyUHJlc2VudEZvckNvbCA9IGZ1bmN0aW9uKGNvbEtleSkge1xyXG4gICAgdmFyIGZpbHRlcldyYXBwZXIgPSB0aGlzLmFsbEZpbHRlcnNbY29sS2V5XTtcclxuICAgIGlmICghZmlsdGVyV3JhcHBlcikge1xyXG4gICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuICAgIGlmICghZmlsdGVyV3JhcHBlci5maWx0ZXIuaXNGaWx0ZXJBY3RpdmUpIHsgLy8gYmVjYXVzZSB1c2VycyBjYW4gZG8gY3VzdG9tIGZpbHRlcnMsIGdpdmUgbmljZSBlcnJvciBtZXNzYWdlXHJcbiAgICAgICAgY29uc29sZS5lcnJvcignRmlsdGVyIGlzIG1pc3NpbmcgbWV0aG9kIGlzRmlsdGVyQWN0aXZlJyk7XHJcbiAgICB9XHJcbiAgICB2YXIgZmlsdGVyUHJlc2VudCA9IGZpbHRlcldyYXBwZXIuZmlsdGVyLmlzRmlsdGVyQWN0aXZlKCk7XHJcbiAgICByZXR1cm4gZmlsdGVyUHJlc2VudDtcclxufTtcclxuXHJcbkZpbHRlck1hbmFnZXIucHJvdG90eXBlLmRvZXNGaWx0ZXJQYXNzID0gZnVuY3Rpb24obm9kZSkge1xyXG4gICAgdmFyIGRhdGEgPSBub2RlLmRhdGE7XHJcbiAgICB2YXIgY29sS2V5cyA9IE9iamVjdC5rZXlzKHRoaXMuYWxsRmlsdGVycyk7XHJcbiAgICBmb3IgKHZhciBpID0gMCwgbCA9IGNvbEtleXMubGVuZ3RoOyBpIDwgbDsgaSsrKSB7IC8vIGNyaXRpY2FsIGNvZGUsIGRvbid0IHVzZSBmdW5jdGlvbmFsIHByb2dyYW1taW5nXHJcblxyXG4gICAgICAgIHZhciBjb2xLZXkgPSBjb2xLZXlzW2ldO1xyXG4gICAgICAgIHZhciBmaWx0ZXJXcmFwcGVyID0gdGhpcy5hbGxGaWx0ZXJzW2NvbEtleV07XHJcblxyXG4gICAgICAgIC8vIGlmIG5vIGZpbHRlciwgYWx3YXlzIHBhc3NcclxuICAgICAgICBpZiAoZmlsdGVyV3JhcHBlciA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdmFyIHZhbHVlID0gZGF0YVtmaWx0ZXJXcmFwcGVyLmZpZWxkXTtcclxuICAgICAgICBpZiAoIWZpbHRlcldyYXBwZXIuZmlsdGVyLmRvZXNGaWx0ZXJQYXNzKSB7IC8vIGJlY2F1c2UgdXNlcnMgY2FuIGRvIGN1c3RvbSBmaWx0ZXJzLCBnaXZlIG5pY2UgZXJyb3IgbWVzc2FnZVxyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdGaWx0ZXIgaXMgbWlzc2luZyBtZXRob2QgZG9lc0ZpbHRlclBhc3MnKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgdmFyIG1vZGVsO1xyXG4gICAgICAgIC8vIGlmIG1vZGVsIGlzIGV4cG9zZWQsIGdyYWIgaXRcclxuICAgICAgICBpZiAoZmlsdGVyV3JhcHBlci5maWx0ZXIuZ2V0TW9kZWwpIHtcclxuICAgICAgICAgICAgbW9kZWwgPSBmaWx0ZXJXcmFwcGVyLmZpbHRlci5nZXRNb2RlbCgpO1xyXG4gICAgICAgIH1cclxuICAgICAgICB2YXIgcGFyYW1zID0ge1xyXG4gICAgICAgICAgICB2YWx1ZTogdmFsdWUsXHJcbiAgICAgICAgICAgIG1vZGVsOiBtb2RlbCxcclxuICAgICAgICAgICAgbm9kZTogbm9kZSxcclxuICAgICAgICAgICAgZGF0YTogZGF0YVxyXG4gICAgICAgIH07XHJcbiAgICAgICAgaWYgKCFmaWx0ZXJXcmFwcGVyLmZpbHRlci5kb2VzRmlsdGVyUGFzcyhwYXJhbXMpKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICAvLyBhbGwgZmlsdGVycyBwYXNzZWRcclxuICAgIHJldHVybiB0cnVlO1xyXG59O1xyXG5cclxuRmlsdGVyTWFuYWdlci5wcm90b3R5cGUub25OZXdSb3dzTG9hZGVkID0gZnVuY3Rpb24oKSB7XHJcbiAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICBPYmplY3Qua2V5cyh0aGlzLmFsbEZpbHRlcnMpLmZvckVhY2goZnVuY3Rpb24oZmllbGQpIHtcclxuICAgICAgICB2YXIgZmlsdGVyID0gdGhhdC5hbGxGaWx0ZXJzW2ZpZWxkXS5maWx0ZXI7XHJcbiAgICAgICAgaWYgKGZpbHRlci5vbk5ld1Jvd3NMb2FkZWQpIHtcclxuICAgICAgICAgICAgZmlsdGVyLm9uTmV3Um93c0xvYWRlZCgpO1xyXG4gICAgICAgIH1cclxuICAgIH0pO1xyXG59O1xyXG5cclxuRmlsdGVyTWFuYWdlci5wcm90b3R5cGUucG9zaXRpb25Qb3B1cCA9IGZ1bmN0aW9uKGV2ZW50U291cmNlLCBlUG9wdXAsIGVQb3B1cFJvb3QpIHtcclxuICAgIHZhciBzb3VyY2VSZWN0ID0gZXZlbnRTb3VyY2UuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XHJcbiAgICB2YXIgcGFyZW50UmVjdCA9IGVQb3B1cFJvb3QuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XHJcblxyXG4gICAgdmFyIHggPSBzb3VyY2VSZWN0LmxlZnQgLSBwYXJlbnRSZWN0LmxlZnQ7XHJcbiAgICB2YXIgeSA9IHNvdXJjZVJlY3QudG9wIC0gcGFyZW50UmVjdC50b3AgKyBzb3VyY2VSZWN0LmhlaWdodDtcclxuXHJcbiAgICAvLyBpZiBwb3B1cCBpcyBvdmVyZmxvd2luZyB0byB0aGUgcmlnaHQsIG1vdmUgaXQgbGVmdFxyXG4gICAgdmFyIHdpZHRoT2ZQb3B1cCA9IDIwMDsgLy8gdGhpcyBpcyBzZXQgaW4gdGhlIGNzc1xyXG4gICAgdmFyIHdpZHRoT2ZQYXJlbnQgPSBwYXJlbnRSZWN0LnJpZ2h0IC0gcGFyZW50UmVjdC5sZWZ0O1xyXG4gICAgdmFyIG1heFggPSB3aWR0aE9mUGFyZW50IC0gd2lkdGhPZlBvcHVwIC0gMjA7IC8vIDIwIHBpeGVscyBncmFjZVxyXG4gICAgaWYgKHggPiBtYXhYKSB7IC8vIG1vdmUgcG9zaXRpb24gbGVmdCwgYmFjayBpbnRvIHZpZXdcclxuICAgICAgICB4ID0gbWF4WDtcclxuICAgIH1cclxuICAgIGlmICh4IDwgMCkgeyAvLyBpbiBjYXNlIHRoZSBwb3B1cCBoYXMgYSBuZWdhdGl2ZSB2YWx1ZVxyXG4gICAgICAgIHggPSAwO1xyXG4gICAgfVxyXG5cclxuICAgIGVQb3B1cC5zdHlsZS5sZWZ0ID0geCArIFwicHhcIjtcclxuICAgIGVQb3B1cC5zdHlsZS50b3AgPSB5ICsgXCJweFwiO1xyXG59O1xyXG5cclxuRmlsdGVyTWFuYWdlci5wcm90b3R5cGUuc2hvd0ZpbHRlciA9IGZ1bmN0aW9uKGNvbERlZldyYXBwZXIsIGV2ZW50U291cmNlKSB7XHJcblxyXG4gICAgdmFyIGZpbHRlcldyYXBwZXIgPSB0aGlzLmFsbEZpbHRlcnNbY29sRGVmV3JhcHBlci5jb2xLZXldO1xyXG4gICAgdmFyIGNvbERlZiA9IGNvbERlZldyYXBwZXIuY29sRGVmO1xyXG5cclxuICAgIGlmICghZmlsdGVyV3JhcHBlcikge1xyXG4gICAgICAgIGZpbHRlcldyYXBwZXIgPSB7XHJcbiAgICAgICAgICAgIGNvbEtleTogY29sRGVmV3JhcHBlci5jb2xLZXksXHJcbiAgICAgICAgICAgIGZpZWxkOiBjb2xEZWYuZmllbGRcclxuICAgICAgICB9O1xyXG4gICAgICAgIHZhciBmaWx0ZXJDaGFuZ2VkQ2FsbGJhY2sgPSB0aGlzLmdyaWQub25GaWx0ZXJDaGFuZ2VkLmJpbmQodGhpcy5ncmlkKTtcclxuICAgICAgICB2YXIgZmlsdGVyUGFyYW1zID0gY29sRGVmLmZpbHRlclBhcmFtcztcclxuICAgICAgICB2YXIgcGFyYW1zID0ge1xyXG4gICAgICAgICAgICBjb2xEZWY6IGNvbERlZixcclxuICAgICAgICAgICAgcm93TW9kZWw6IHRoaXMucm93TW9kZWwsXHJcbiAgICAgICAgICAgIGZpbHRlckNoYW5nZWRDYWxsYmFjazogZmlsdGVyQ2hhbmdlZENhbGxiYWNrLFxyXG4gICAgICAgICAgICBmaWx0ZXJQYXJhbXM6IGZpbHRlclBhcmFtcyxcclxuICAgICAgICAgICAgc2NvcGU6IGZpbHRlcldyYXBwZXIuc2NvcGVcclxuICAgICAgICB9O1xyXG4gICAgICAgIGlmICh0eXBlb2YgY29sRGVmLmZpbHRlciA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICAgICAgICAvLyBpZiB1c2VyIHByb3ZpZGVkIGEgZmlsdGVyLCBqdXN0IHVzZSBpdFxyXG4gICAgICAgICAgICAvLyBmaXJzdCB1cCwgY3JlYXRlIGNoaWxkIHNjb3BlIGlmIG5lZWRlZFxyXG4gICAgICAgICAgICBpZiAodGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuaXNBbmd1bGFyQ29tcGlsZUZpbHRlcnMoKSkge1xyXG4gICAgICAgICAgICAgICAgdmFyIHNjb3BlID0gdGhpcy4kc2NvcGUuJG5ldygpO1xyXG4gICAgICAgICAgICAgICAgZmlsdGVyV3JhcHBlci5zY29wZSA9IHNjb3BlO1xyXG4gICAgICAgICAgICAgICAgcGFyYW1zLiRzY29wZSA9IHNjb3BlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC8vIG5vdyBjcmVhdGUgZmlsdGVyXHJcbiAgICAgICAgICAgIGZpbHRlcldyYXBwZXIuZmlsdGVyID0gbmV3IGNvbERlZi5maWx0ZXIocGFyYW1zKTtcclxuICAgICAgICB9IGVsc2UgaWYgKGNvbERlZi5maWx0ZXIgPT09ICd0ZXh0Jykge1xyXG4gICAgICAgICAgICBmaWx0ZXJXcmFwcGVyLmZpbHRlciA9IG5ldyBTdHJpbmdGaWx0ZXIocGFyYW1zKTtcclxuICAgICAgICB9IGVsc2UgaWYgKGNvbERlZi5maWx0ZXIgPT09ICdudW1iZXInKSB7XHJcbiAgICAgICAgICAgIGZpbHRlcldyYXBwZXIuZmlsdGVyID0gbmV3IE51bWJlckZpbHRlcihwYXJhbXMpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGZpbHRlcldyYXBwZXIuZmlsdGVyID0gbmV3IFNldEZpbHRlcihwYXJhbXMpO1xyXG4gICAgICAgIH1cclxuICAgICAgICB0aGlzLmFsbEZpbHRlcnNbY29sRGVmV3JhcHBlci5jb2xLZXldID0gZmlsdGVyV3JhcHBlcjtcclxuXHJcbiAgICAgICAgaWYgKCFmaWx0ZXJXcmFwcGVyLmZpbHRlci5nZXRHdWkpIHsgLy8gYmVjYXVzZSB1c2VycyBjYW4gZG8gY3VzdG9tIGZpbHRlcnMsIGdpdmUgbmljZSBlcnJvciBtZXNzYWdlXHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZpbHRlciBpcyBtaXNzaW5nIG1ldGhvZCBnZXRHdWknKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHZhciBlRmlsdGVyR3VpID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XHJcbiAgICAgICAgZUZpbHRlckd1aS5jbGFzc05hbWUgPSAnYWctZmlsdGVyJztcclxuICAgICAgICB2YXIgZ3VpRnJvbUZpbHRlciA9IGZpbHRlcldyYXBwZXIuZmlsdGVyLmdldEd1aSgpO1xyXG4gICAgICAgIGlmICh1dGlscy5pc05vZGUoZ3VpRnJvbUZpbHRlcikgfHwgdXRpbHMuaXNFbGVtZW50KGd1aUZyb21GaWx0ZXIpKSB7XHJcbiAgICAgICAgICAgIC8vYSBkb20gbm9kZSBvciBlbGVtZW50IHdhcyByZXR1cm5lZCwgc28gYWRkIGNoaWxkXHJcbiAgICAgICAgICAgIGVGaWx0ZXJHdWkuYXBwZW5kQ2hpbGQoZ3VpRnJvbUZpbHRlcik7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgLy9vdGhlcndpc2UgYXNzdW1lIGl0IHdhcyBodG1sLCBzbyBqdXN0IGluc2VydFxyXG4gICAgICAgICAgICB2YXIgZVRleHRTcGFuID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc3BhbicpO1xyXG4gICAgICAgICAgICBlVGV4dFNwYW4uaW5uZXJIVE1MID0gZ3VpRnJvbUZpbHRlcjtcclxuICAgICAgICAgICAgZUZpbHRlckd1aS5hcHBlbmRDaGlsZChlVGV4dFNwYW4pO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKGZpbHRlcldyYXBwZXIuc2NvcGUpIHtcclxuICAgICAgICAgICAgZmlsdGVyV3JhcHBlci5ndWkgPSB0aGlzLiRjb21waWxlKGVGaWx0ZXJHdWkpKGZpbHRlcldyYXBwZXIuc2NvcGUpWzBdO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGZpbHRlcldyYXBwZXIuZ3VpID0gZUZpbHRlckd1aTtcclxuICAgICAgICB9XHJcblxyXG4gICAgfVxyXG5cclxuICAgIHZhciBlUG9wdXBQYXJlbnQgPSB0aGlzLmdyaWQuZ2V0UG9wdXBQYXJlbnQoKTtcclxuICAgIHRoaXMucG9zaXRpb25Qb3B1cChldmVudFNvdXJjZSwgZmlsdGVyV3JhcHBlci5ndWksIGVQb3B1cFBhcmVudCk7XHJcblxyXG4gICAgdXRpbHMuYWRkQXNNb2RhbFBvcHVwKGVQb3B1cFBhcmVudCwgZmlsdGVyV3JhcHBlci5ndWkpO1xyXG5cclxuICAgIGlmIChmaWx0ZXJXcmFwcGVyLmZpbHRlci5hZnRlckd1aUF0dGFjaGVkKSB7XHJcbiAgICAgICAgZmlsdGVyV3JhcHBlci5maWx0ZXIuYWZ0ZXJHdWlBdHRhY2hlZCgpO1xyXG4gICAgfVxyXG59O1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBGaWx0ZXJNYW5hZ2VyO1xyXG4iLCJ2YXIgdXRpbHMgPSByZXF1aXJlKCcuLy4uL3V0aWxzJyk7XHJcbnZhciB0ZW1wbGF0ZSA9IHJlcXVpcmUoJy4vbnVtYmVyRmlsdGVyVGVtcGxhdGUuanMnKTtcclxuXHJcbnZhciBFUVVBTFMgPSAxO1xyXG52YXIgTEVTU19USEFOID0gMjtcclxudmFyIEdSRUFURVJfVEhBTiA9IDM7XHJcblxyXG5mdW5jdGlvbiBOdW1iZXJGaWx0ZXIocGFyYW1zKSB7XHJcbiAgICB0aGlzLmZpbHRlckNoYW5nZWRDYWxsYmFjayA9IHBhcmFtcy5maWx0ZXJDaGFuZ2VkQ2FsbGJhY2s7XHJcbiAgICB0aGlzLmNyZWF0ZUd1aSgpO1xyXG4gICAgdGhpcy5maWx0ZXJOdW1iZXIgPSBudWxsO1xyXG4gICAgdGhpcy5maWx0ZXJUeXBlID0gRVFVQUxTO1xyXG59XHJcblxyXG4vKiBwdWJsaWMgKi9cclxuTnVtYmVyRmlsdGVyLnByb3RvdHlwZS5hZnRlckd1aUF0dGFjaGVkID0gZnVuY3Rpb24oKSB7XHJcbiAgICB0aGlzLmVGaWx0ZXJUZXh0RmllbGQuZm9jdXMoKTtcclxufTtcclxuXHJcbi8qIHB1YmxpYyAqL1xyXG5OdW1iZXJGaWx0ZXIucHJvdG90eXBlLmRvZXNGaWx0ZXJQYXNzID0gZnVuY3Rpb24obm9kZSkge1xyXG4gICAgaWYgKHRoaXMuZmlsdGVyTnVtYmVyID09PSBudWxsKSB7XHJcbiAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICB9XHJcbiAgICB2YXIgdmFsdWUgPSBub2RlLnZhbHVlO1xyXG5cclxuICAgIGlmICghdmFsdWUgJiYgdmFsdWUgIT09IDApIHtcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcblxyXG4gICAgdmFyIHZhbHVlQXNOdW1iZXI7XHJcbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJykge1xyXG4gICAgICAgIHZhbHVlQXNOdW1iZXIgPSB2YWx1ZTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdmFsdWVBc051bWJlciA9IHBhcnNlRmxvYXQodmFsdWUpO1xyXG4gICAgfVxyXG5cclxuICAgIHN3aXRjaCAodGhpcy5maWx0ZXJUeXBlKSB7XHJcbiAgICAgICAgY2FzZSBFUVVBTFM6XHJcbiAgICAgICAgICAgIHJldHVybiB2YWx1ZUFzTnVtYmVyID09PSB0aGlzLmZpbHRlck51bWJlcjtcclxuICAgICAgICBjYXNlIExFU1NfVEhBTjpcclxuICAgICAgICAgICAgcmV0dXJuIHZhbHVlQXNOdW1iZXIgPD0gdGhpcy5maWx0ZXJOdW1iZXI7XHJcbiAgICAgICAgY2FzZSBHUkVBVEVSX1RIQU46XHJcbiAgICAgICAgICAgIHJldHVybiB2YWx1ZUFzTnVtYmVyID49IHRoaXMuZmlsdGVyTnVtYmVyO1xyXG4gICAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgICAgIC8vIHNob3VsZCBuZXZlciBoYXBwZW5cclxuICAgICAgICAgICAgY29uc29sZS5sb2coJ2ludmFsaWQgZmlsdGVyIHR5cGUgJyArIHRoaXMuZmlsdGVyVHlwZSk7XHJcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxufTtcclxuXHJcbi8qIHB1YmxpYyAqL1xyXG5OdW1iZXJGaWx0ZXIucHJvdG90eXBlLmdldEd1aSA9IGZ1bmN0aW9uKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuZUd1aTtcclxufTtcclxuXHJcbi8qIHB1YmxpYyAqL1xyXG5OdW1iZXJGaWx0ZXIucHJvdG90eXBlLmlzRmlsdGVyQWN0aXZlID0gZnVuY3Rpb24oKSB7XHJcbiAgICByZXR1cm4gdGhpcy5maWx0ZXJOdW1iZXIgIT09IG51bGw7XHJcbn07XHJcblxyXG5OdW1iZXJGaWx0ZXIucHJvdG90eXBlLmNyZWF0ZUd1aSA9IGZ1bmN0aW9uKCkge1xyXG4gICAgdGhpcy5lR3VpID0gdXRpbHMubG9hZFRlbXBsYXRlKHRlbXBsYXRlKTtcclxuICAgIHRoaXMuZUZpbHRlclRleHRGaWVsZCA9IHRoaXMuZUd1aS5xdWVyeVNlbGVjdG9yKFwiI2ZpbHRlclRleHRcIik7XHJcbiAgICB0aGlzLmVUeXBlU2VsZWN0ID0gdGhpcy5lR3VpLnF1ZXJ5U2VsZWN0b3IoXCIjZmlsdGVyVHlwZVwiKTtcclxuXHJcbiAgICB1dGlscy5hZGRDaGFuZ2VMaXN0ZW5lcih0aGlzLmVGaWx0ZXJUZXh0RmllbGQsIHRoaXMub25GaWx0ZXJDaGFuZ2VkLmJpbmQodGhpcykpO1xyXG4gICAgdGhpcy5lVHlwZVNlbGVjdC5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlXCIsIHRoaXMub25UeXBlQ2hhbmdlZC5iaW5kKHRoaXMpKTtcclxufTtcclxuXHJcbk51bWJlckZpbHRlci5wcm90b3R5cGUub25UeXBlQ2hhbmdlZCA9IGZ1bmN0aW9uKCkge1xyXG4gICAgdGhpcy5maWx0ZXJUeXBlID0gcGFyc2VJbnQodGhpcy5lVHlwZVNlbGVjdC52YWx1ZSk7XHJcbiAgICB0aGlzLmZpbHRlckNoYW5nZWRDYWxsYmFjaygpO1xyXG59O1xyXG5cclxuTnVtYmVyRmlsdGVyLnByb3RvdHlwZS5vbkZpbHRlckNoYW5nZWQgPSBmdW5jdGlvbigpIHtcclxuICAgIHZhciBmaWx0ZXJUZXh0ID0gdXRpbHMubWFrZU51bGwodGhpcy5lRmlsdGVyVGV4dEZpZWxkLnZhbHVlKTtcclxuICAgIGlmIChmaWx0ZXJUZXh0ICYmIGZpbHRlclRleHQudHJpbSgpID09PSAnJykge1xyXG4gICAgICAgIGZpbHRlclRleHQgPSBudWxsO1xyXG4gICAgfVxyXG4gICAgaWYgKGZpbHRlclRleHQpIHtcclxuICAgICAgICB0aGlzLmZpbHRlck51bWJlciA9IHBhcnNlRmxvYXQoZmlsdGVyVGV4dCk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHRoaXMuZmlsdGVyTnVtYmVyID0gbnVsbDtcclxuICAgIH1cclxuICAgIHRoaXMuZmlsdGVyQ2hhbmdlZENhbGxiYWNrKCk7XHJcbn07XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IE51bWJlckZpbHRlcjtcclxuIiwidmFyIHRlbXBsYXRlID0gW1xyXG4gICAgJzxkaXY+JyxcclxuICAgICc8ZGl2PicsXHJcbiAgICAnPHNlbGVjdCBjbGFzcz1cImFnLWZpbHRlci1zZWxlY3RcIiBpZD1cImZpbHRlclR5cGVcIj4nLFxyXG4gICAgJzxvcHRpb24gdmFsdWU9XCIxXCI+RXF1YWxzPC9vcHRpb24+JyxcclxuICAgICc8b3B0aW9uIHZhbHVlPVwiMlwiPkxlc3MgdGhhbjwvb3B0aW9uPicsXHJcbiAgICAnPG9wdGlvbiB2YWx1ZT1cIjNcIj5HcmVhdGVyIHRoYW48L29wdGlvbj4nLFxyXG4gICAgJzwvc2VsZWN0PicsXHJcbiAgICAnPC9kaXY+JyxcclxuICAgICc8ZGl2PicsXHJcbiAgICAnPGlucHV0IGNsYXNzPVwiYWctZmlsdGVyLWZpbHRlclwiIGlkPVwiZmlsdGVyVGV4dFwiIHR5cGU9XCJ0ZXh0XCIgcGxhY2Vob2xkZXI9XCJmaWx0ZXIuLi5cIi8+JyxcclxuICAgICc8L2Rpdj4nLFxyXG4gICAgJzwvZGl2PicsXHJcbl0uam9pbignJyk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IHRlbXBsYXRlO1xyXG4iLCJ2YXIgdXRpbHMgPSByZXF1aXJlKCcuLy4uL3V0aWxzJyk7XHJcbnZhciBTZXRGaWx0ZXJNb2RlbCA9IHJlcXVpcmUoJy4vc2V0RmlsdGVyTW9kZWwnKTtcclxudmFyIHRlbXBsYXRlID0gcmVxdWlyZSgnLi9zZXRGaWx0ZXJUZW1wbGF0ZScpO1xyXG5cclxudmFyIERFRkFVTFRfUk9XX0hFSUdIVCA9IDIwO1xyXG5cclxuZnVuY3Rpb24gU2V0RmlsdGVyKHBhcmFtcykge1xyXG4gICAgdmFyIGZpbHRlclBhcmFtcyA9IHBhcmFtcy5maWx0ZXJQYXJhbXM7XHJcbiAgICB0aGlzLnJvd0hlaWdodCA9IChmaWx0ZXJQYXJhbXMgJiYgZmlsdGVyUGFyYW1zLmNlbGxIZWlnaHQpID8gZmlsdGVyUGFyYW1zLmNlbGxIZWlnaHQgOiBERUZBVUxUX1JPV19IRUlHSFQ7XHJcbiAgICB0aGlzLm1vZGVsID0gbmV3IFNldEZpbHRlck1vZGVsKHBhcmFtcy5jb2xEZWYsIHBhcmFtcy5yb3dNb2RlbCk7XHJcbiAgICB0aGlzLmZpbHRlckNoYW5nZWRDYWxsYmFjayA9IHBhcmFtcy5maWx0ZXJDaGFuZ2VkQ2FsbGJhY2s7XHJcbiAgICB0aGlzLnJvd3NJbkJvZHlDb250YWluZXIgPSB7fTtcclxuICAgIHRoaXMuY29sRGVmID0gcGFyYW1zLmNvbERlZjtcclxuICAgIGlmIChmaWx0ZXJQYXJhbXMpIHtcclxuICAgICAgICB0aGlzLmNlbGxSZW5kZXJlciA9IGZpbHRlclBhcmFtcy5jZWxsUmVuZGVyZXI7XHJcbiAgICB9XHJcbiAgICB0aGlzLmNyZWF0ZUd1aSgpO1xyXG4gICAgdGhpcy5hZGRTY3JvbGxMaXN0ZW5lcigpO1xyXG59XHJcblxyXG4vLyB3ZSBuZWVkIHRvIGhhdmUgdGhlIGd1aSBhdHRhY2hlZCBiZWZvcmUgd2UgY2FuIGRyYXcgdGhlIHZpcnR1YWwgcm93cywgYXMgdGhlXHJcbi8vIHZpcnR1YWwgcm93IGxvZ2ljIG5lZWRzIGluZm8gYWJvdXQgdGhlIGd1aSBzdGF0ZVxyXG4vKiBwdWJsaWMgKi9cclxuU2V0RmlsdGVyLnByb3RvdHlwZS5hZnRlckd1aUF0dGFjaGVkID0gZnVuY3Rpb24oKSB7XHJcbiAgICB0aGlzLmRyYXdWaXJ0dWFsUm93cygpO1xyXG59O1xyXG5cclxuLyogcHVibGljICovXHJcblNldEZpbHRlci5wcm90b3R5cGUuaXNGaWx0ZXJBY3RpdmUgPSBmdW5jdGlvbigpIHtcclxuICAgIHJldHVybiB0aGlzLm1vZGVsLmlzRmlsdGVyQWN0aXZlKCk7XHJcbn07XHJcblxyXG4vKiBwdWJsaWMgKi9cclxuU2V0RmlsdGVyLnByb3RvdHlwZS5kb2VzRmlsdGVyUGFzcyA9IGZ1bmN0aW9uKG5vZGUpIHtcclxuICAgIHZhciB2YWx1ZSA9IG5vZGUudmFsdWU7XHJcbiAgICB2YXIgbW9kZWwgPSBub2RlLm1vZGVsO1xyXG4gICAgLy9pZiBubyBmaWx0ZXIsIGFsd2F5cyBwYXNzXHJcbiAgICBpZiAobW9kZWwuaXNFdmVyeXRoaW5nU2VsZWN0ZWQoKSkge1xyXG4gICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgfVxyXG4gICAgLy9pZiBub3RoaW5nIHNlbGVjdGVkIGluIGZpbHRlciwgYWx3YXlzIGZhaWxcclxuICAgIGlmIChtb2RlbC5pc05vdGhpbmdTZWxlY3RlZCgpKSB7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG5cclxuICAgIHZhbHVlID0gdXRpbHMubWFrZU51bGwodmFsdWUpO1xyXG4gICAgdmFyIGZpbHRlclBhc3NlZCA9IG1vZGVsLnNlbGVjdGVkVmFsdWVzTWFwW3ZhbHVlXSAhPT0gdW5kZWZpbmVkO1xyXG4gICAgcmV0dXJuIGZpbHRlclBhc3NlZDtcclxufTtcclxuXHJcbi8qIHB1YmxpYyAqL1xyXG5TZXRGaWx0ZXIucHJvdG90eXBlLmdldEd1aSA9IGZ1bmN0aW9uKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuZUd1aTtcclxufTtcclxuXHJcbi8qIHB1YmxpYyAqL1xyXG5TZXRGaWx0ZXIucHJvdG90eXBlLm9uTmV3Um93c0xvYWRlZCA9IGZ1bmN0aW9uKCkge1xyXG4gICAgdGhpcy5tb2RlbC5zZWxlY3RFdmVyeXRoaW5nKCk7XHJcbiAgICB0aGlzLnVwZGF0ZUFsbENoZWNrYm94ZXModHJ1ZSk7XHJcbn07XHJcblxyXG4vKiBwdWJsaWMgKi9cclxuU2V0RmlsdGVyLnByb3RvdHlwZS5nZXRNb2RlbCA9IGZ1bmN0aW9uKCkge1xyXG4gICAgcmV0dXJuIHRoaXMubW9kZWw7XHJcbn07XHJcblxyXG5TZXRGaWx0ZXIucHJvdG90eXBlLmNyZWF0ZUd1aSA9IGZ1bmN0aW9uKCkge1xyXG4gICAgdmFyIF90aGlzID0gdGhpcztcclxuXHJcbiAgICB0aGlzLmVHdWkgPSB1dGlscy5sb2FkVGVtcGxhdGUodGVtcGxhdGUpO1xyXG5cclxuICAgIHRoaXMuZUxpc3RDb250YWluZXIgPSB0aGlzLmVHdWkucXVlcnlTZWxlY3RvcihcIi5hZy1maWx0ZXItbGlzdC1jb250YWluZXJcIik7XHJcbiAgICB0aGlzLmVGaWx0ZXJWYWx1ZVRlbXBsYXRlID0gdGhpcy5lR3VpLnF1ZXJ5U2VsZWN0b3IoXCIjaXRlbUZvclJlcGVhdFwiKTtcclxuICAgIHRoaXMuZVNlbGVjdEFsbCA9IHRoaXMuZUd1aS5xdWVyeVNlbGVjdG9yKFwiI3NlbGVjdEFsbFwiKTtcclxuICAgIHRoaXMuZUxpc3RWaWV3cG9ydCA9IHRoaXMuZUd1aS5xdWVyeVNlbGVjdG9yKFwiLmFnLWZpbHRlci1saXN0LXZpZXdwb3J0XCIpO1xyXG4gICAgdGhpcy5lTWluaUZpbHRlciA9IHRoaXMuZUd1aS5xdWVyeVNlbGVjdG9yKFwiLmFnLWZpbHRlci1maWx0ZXJcIik7XHJcbiAgICB0aGlzLmVMaXN0Q29udGFpbmVyLnN0eWxlLmhlaWdodCA9ICh0aGlzLm1vZGVsLmdldFVuaXF1ZVZhbHVlQ291bnQoKSAqIHRoaXMucm93SGVpZ2h0KSArIFwicHhcIjtcclxuXHJcbiAgICB0aGlzLnNldENvbnRhaW5lckhlaWdodCgpO1xyXG4gICAgdGhpcy5lTWluaUZpbHRlci52YWx1ZSA9IHRoaXMubW9kZWwuZ2V0TWluaUZpbHRlcigpO1xyXG4gICAgdXRpbHMuYWRkQ2hhbmdlTGlzdGVuZXIodGhpcy5lTWluaUZpbHRlciwgZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgX3RoaXMub25GaWx0ZXJDaGFuZ2VkKCk7XHJcbiAgICB9KTtcclxuICAgIHV0aWxzLnJlbW92ZUFsbENoaWxkcmVuKHRoaXMuZUxpc3RDb250YWluZXIpO1xyXG5cclxuICAgIHRoaXMuZVNlbGVjdEFsbC5vbmNsaWNrID0gdGhpcy5vblNlbGVjdEFsbC5iaW5kKHRoaXMpO1xyXG5cclxuICAgIGlmICh0aGlzLm1vZGVsLmlzRXZlcnl0aGluZ1NlbGVjdGVkKCkpIHtcclxuICAgICAgICB0aGlzLmVTZWxlY3RBbGwuaW5kZXRlcm1pbmF0ZSA9IGZhbHNlO1xyXG4gICAgICAgIHRoaXMuZVNlbGVjdEFsbC5jaGVja2VkID0gdHJ1ZTtcclxuICAgIH0gZWxzZSBpZiAodGhpcy5tb2RlbC5pc05vdGhpbmdTZWxlY3RlZCgpKSB7XHJcbiAgICAgICAgdGhpcy5lU2VsZWN0QWxsLmluZGV0ZXJtaW5hdGUgPSBmYWxzZTtcclxuICAgICAgICB0aGlzLmVTZWxlY3RBbGwuY2hlY2tlZCA9IGZhbHNlO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICB0aGlzLmVTZWxlY3RBbGwuaW5kZXRlcm1pbmF0ZSA9IHRydWU7XHJcbiAgICB9XHJcbn07XHJcblxyXG5TZXRGaWx0ZXIucHJvdG90eXBlLnNldENvbnRhaW5lckhlaWdodCA9IGZ1bmN0aW9uKCkge1xyXG4gICAgdGhpcy5lTGlzdENvbnRhaW5lci5zdHlsZS5oZWlnaHQgPSAodGhpcy5tb2RlbC5nZXREaXNwbGF5ZWRWYWx1ZUNvdW50KCkgKiB0aGlzLnJvd0hlaWdodCkgKyBcInB4XCI7XHJcbn07XHJcblxyXG5TZXRGaWx0ZXIucHJvdG90eXBlLmRyYXdWaXJ0dWFsUm93cyA9IGZ1bmN0aW9uKCkge1xyXG4gICAgdmFyIHRvcFBpeGVsID0gdGhpcy5lTGlzdFZpZXdwb3J0LnNjcm9sbFRvcDtcclxuICAgIHZhciBib3R0b21QaXhlbCA9IHRvcFBpeGVsICsgdGhpcy5lTGlzdFZpZXdwb3J0Lm9mZnNldEhlaWdodDtcclxuXHJcbiAgICB2YXIgZmlyc3RSb3cgPSBNYXRoLmZsb29yKHRvcFBpeGVsIC8gdGhpcy5yb3dIZWlnaHQpO1xyXG4gICAgdmFyIGxhc3RSb3cgPSBNYXRoLmZsb29yKGJvdHRvbVBpeGVsIC8gdGhpcy5yb3dIZWlnaHQpO1xyXG5cclxuICAgIHRoaXMuZW5zdXJlUm93c1JlbmRlcmVkKGZpcnN0Um93LCBsYXN0Um93KTtcclxufTtcclxuXHJcblNldEZpbHRlci5wcm90b3R5cGUuZW5zdXJlUm93c1JlbmRlcmVkID0gZnVuY3Rpb24oc3RhcnQsIGZpbmlzaCkge1xyXG4gICAgdmFyIF90aGlzID0gdGhpcztcclxuXHJcbiAgICAvL2F0IHRoZSBlbmQsIHRoaXMgYXJyYXkgd2lsbCBjb250YWluIHRoZSBpdGVtcyB3ZSBuZWVkIHRvIHJlbW92ZVxyXG4gICAgdmFyIHJvd3NUb1JlbW92ZSA9IE9iamVjdC5rZXlzKHRoaXMucm93c0luQm9keUNvbnRhaW5lcik7XHJcblxyXG4gICAgLy9hZGQgaW4gbmV3IHJvd3NcclxuICAgIGZvciAodmFyIHJvd0luZGV4ID0gc3RhcnQ7IHJvd0luZGV4IDw9IGZpbmlzaDsgcm93SW5kZXgrKykge1xyXG4gICAgICAgIC8vc2VlIGlmIGl0ZW0gYWxyZWFkeSB0aGVyZSwgYW5kIGlmIHllcywgdGFrZSBpdCBvdXQgb2YgdGhlICd0byByZW1vdmUnIGFycmF5XHJcbiAgICAgICAgaWYgKHJvd3NUb1JlbW92ZS5pbmRleE9mKHJvd0luZGV4LnRvU3RyaW5nKCkpID49IDApIHtcclxuICAgICAgICAgICAgcm93c1RvUmVtb3ZlLnNwbGljZShyb3dzVG9SZW1vdmUuaW5kZXhPZihyb3dJbmRleC50b1N0cmluZygpKSwgMSk7XHJcbiAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuICAgICAgICAvL2NoZWNrIHRoaXMgcm93IGFjdHVhbGx5IGV4aXN0cyAoaW4gY2FzZSBvdmVyZmxvdyBidWZmZXIgd2luZG93IGV4Y2VlZHMgcmVhbCBkYXRhKVxyXG4gICAgICAgIGlmICh0aGlzLm1vZGVsLmdldERpc3BsYXllZFZhbHVlQ291bnQoKSA+IHJvd0luZGV4KSB7XHJcbiAgICAgICAgICAgIHZhciB2YWx1ZSA9IHRoaXMubW9kZWwuZ2V0RGlzcGxheWVkVmFsdWUocm93SW5kZXgpO1xyXG4gICAgICAgICAgICBfdGhpcy5pbnNlcnRSb3codmFsdWUsIHJvd0luZGV4KTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLy9hdCB0aGlzIHBvaW50LCBldmVyeXRoaW5nIGluIG91ciAncm93c1RvUmVtb3ZlJyAuIC4gLlxyXG4gICAgdGhpcy5yZW1vdmVWaXJ0dWFsUm93cyhyb3dzVG9SZW1vdmUpO1xyXG59O1xyXG5cclxuLy90YWtlcyBhcnJheSBvZiByb3cgaWQnc1xyXG5TZXRGaWx0ZXIucHJvdG90eXBlLnJlbW92ZVZpcnR1YWxSb3dzID0gZnVuY3Rpb24ocm93c1RvUmVtb3ZlKSB7XHJcbiAgICB2YXIgX3RoaXMgPSB0aGlzO1xyXG4gICAgcm93c1RvUmVtb3ZlLmZvckVhY2goZnVuY3Rpb24oaW5kZXhUb1JlbW92ZSkge1xyXG4gICAgICAgIHZhciBlUm93VG9SZW1vdmUgPSBfdGhpcy5yb3dzSW5Cb2R5Q29udGFpbmVyW2luZGV4VG9SZW1vdmVdO1xyXG4gICAgICAgIF90aGlzLmVMaXN0Q29udGFpbmVyLnJlbW92ZUNoaWxkKGVSb3dUb1JlbW92ZSk7XHJcbiAgICAgICAgZGVsZXRlIF90aGlzLnJvd3NJbkJvZHlDb250YWluZXJbaW5kZXhUb1JlbW92ZV07XHJcbiAgICB9KTtcclxufTtcclxuXHJcblNldEZpbHRlci5wcm90b3R5cGUuaW5zZXJ0Um93ID0gZnVuY3Rpb24odmFsdWUsIHJvd0luZGV4KSB7XHJcbiAgICB2YXIgX3RoaXMgPSB0aGlzO1xyXG5cclxuICAgIHZhciBlRmlsdGVyVmFsdWUgPSB0aGlzLmVGaWx0ZXJWYWx1ZVRlbXBsYXRlLmNsb25lTm9kZSh0cnVlKTtcclxuXHJcbiAgICB2YXIgdmFsdWVFbGVtZW50ID0gZUZpbHRlclZhbHVlLnF1ZXJ5U2VsZWN0b3IoXCIuYWctZmlsdGVyLXZhbHVlXCIpO1xyXG4gICAgaWYgKHRoaXMuY2VsbFJlbmRlcmVyKSB7XHJcbiAgICAgICAgLy9yZW5kZXJlciBwcm92aWRlZCwgc28gdXNlIGl0XHJcbiAgICAgICAgdmFyIHJlc3VsdEZyb21SZW5kZXJlciA9IHRoaXMuY2VsbFJlbmRlcmVyKHtcclxuICAgICAgICAgICAgdmFsdWU6IHZhbHVlXHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIGlmICh1dGlscy5pc05vZGUocmVzdWx0RnJvbVJlbmRlcmVyKSB8fCB1dGlscy5pc0VsZW1lbnQocmVzdWx0RnJvbVJlbmRlcmVyKSkge1xyXG4gICAgICAgICAgICAvL2EgZG9tIG5vZGUgb3IgZWxlbWVudCB3YXMgcmV0dXJuZWQsIHNvIGFkZCBjaGlsZFxyXG4gICAgICAgICAgICB2YWx1ZUVsZW1lbnQuYXBwZW5kQ2hpbGQocmVzdWx0RnJvbVJlbmRlcmVyKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAvL290aGVyd2lzZSBhc3N1bWUgaXQgd2FzIGh0bWwsIHNvIGp1c3QgaW5zZXJ0XHJcbiAgICAgICAgICAgIHZhbHVlRWxlbWVudC5pbm5lckhUTUwgPSByZXN1bHRGcm9tUmVuZGVyZXI7XHJcbiAgICAgICAgfVxyXG5cclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgLy9vdGhlcndpc2UgZGlzcGxheSBhcyBhIHN0cmluZ1xyXG4gICAgICAgIHZhciBkaXNwbGF5TmFtZU9mVmFsdWUgPSB2YWx1ZSA9PT0gbnVsbCA/IFwiKEJsYW5rcylcIiA6IHZhbHVlO1xyXG4gICAgICAgIHZhbHVlRWxlbWVudC5pbm5lckhUTUwgPSBkaXNwbGF5TmFtZU9mVmFsdWU7XHJcbiAgICB9XHJcbiAgICB2YXIgZUNoZWNrYm94ID0gZUZpbHRlclZhbHVlLnF1ZXJ5U2VsZWN0b3IoXCJpbnB1dFwiKTtcclxuICAgIGVDaGVja2JveC5jaGVja2VkID0gdGhpcy5tb2RlbC5pc1ZhbHVlU2VsZWN0ZWQodmFsdWUpO1xyXG5cclxuICAgIGVDaGVja2JveC5vbmNsaWNrID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgX3RoaXMub25DaGVja2JveENsaWNrZWQoZUNoZWNrYm94LCB2YWx1ZSk7XHJcbiAgICB9XHJcblxyXG4gICAgZUZpbHRlclZhbHVlLnN0eWxlLnRvcCA9ICh0aGlzLnJvd0hlaWdodCAqIHJvd0luZGV4KSArIFwicHhcIjtcclxuXHJcbiAgICB0aGlzLmVMaXN0Q29udGFpbmVyLmFwcGVuZENoaWxkKGVGaWx0ZXJWYWx1ZSk7XHJcbiAgICB0aGlzLnJvd3NJbkJvZHlDb250YWluZXJbcm93SW5kZXhdID0gZUZpbHRlclZhbHVlO1xyXG59O1xyXG5cclxuU2V0RmlsdGVyLnByb3RvdHlwZS5vbkNoZWNrYm94Q2xpY2tlZCA9IGZ1bmN0aW9uKGVDaGVja2JveCwgdmFsdWUpIHtcclxuICAgIHZhciBjaGVja2VkID0gZUNoZWNrYm94LmNoZWNrZWQ7XHJcbiAgICBpZiAoY2hlY2tlZCkge1xyXG4gICAgICAgIHRoaXMubW9kZWwuc2VsZWN0VmFsdWUodmFsdWUpO1xyXG4gICAgICAgIGlmICh0aGlzLm1vZGVsLmlzRXZlcnl0aGluZ1NlbGVjdGVkKCkpIHtcclxuICAgICAgICAgICAgdGhpcy5lU2VsZWN0QWxsLmluZGV0ZXJtaW5hdGUgPSBmYWxzZTtcclxuICAgICAgICAgICAgdGhpcy5lU2VsZWN0QWxsLmNoZWNrZWQgPSB0cnVlO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHRoaXMuZVNlbGVjdEFsbC5pbmRldGVybWluYXRlID0gdHJ1ZTtcclxuICAgICAgICB9XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHRoaXMubW9kZWwudW5zZWxlY3RWYWx1ZSh2YWx1ZSk7XHJcbiAgICAgICAgLy9pZiBzZXQgaXMgZW1wdHksIG5vdGhpbmcgaXMgc2VsZWN0ZWRcclxuICAgICAgICBpZiAodGhpcy5tb2RlbC5pc05vdGhpbmdTZWxlY3RlZCgpKSB7XHJcbiAgICAgICAgICAgIHRoaXMuZVNlbGVjdEFsbC5pbmRldGVybWluYXRlID0gZmFsc2U7XHJcbiAgICAgICAgICAgIHRoaXMuZVNlbGVjdEFsbC5jaGVja2VkID0gZmFsc2U7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgdGhpcy5lU2VsZWN0QWxsLmluZGV0ZXJtaW5hdGUgPSB0cnVlO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICB0aGlzLmZpbHRlckNoYW5nZWRDYWxsYmFjaygpO1xyXG59O1xyXG5cclxuU2V0RmlsdGVyLnByb3RvdHlwZS5vbkZpbHRlckNoYW5nZWQgPSBmdW5jdGlvbigpIHtcclxuICAgIHZhciBtaW5pRmlsdGVyQ2hhbmdlZCA9IHRoaXMubW9kZWwuc2V0TWluaUZpbHRlcih0aGlzLmVNaW5pRmlsdGVyLnZhbHVlKTtcclxuICAgIGlmIChtaW5pRmlsdGVyQ2hhbmdlZCkge1xyXG4gICAgICAgIHRoaXMuc2V0Q29udGFpbmVySGVpZ2h0KCk7XHJcbiAgICAgICAgdGhpcy5jbGVhclZpcnR1YWxSb3dzKCk7XHJcbiAgICAgICAgdGhpcy5kcmF3VmlydHVhbFJvd3MoKTtcclxuICAgIH1cclxufTtcclxuXHJcblNldEZpbHRlci5wcm90b3R5cGUuY2xlYXJWaXJ0dWFsUm93cyA9IGZ1bmN0aW9uKCkge1xyXG4gICAgdmFyIHJvd3NUb1JlbW92ZSA9IE9iamVjdC5rZXlzKHRoaXMucm93c0luQm9keUNvbnRhaW5lcik7XHJcbiAgICB0aGlzLnJlbW92ZVZpcnR1YWxSb3dzKHJvd3NUb1JlbW92ZSk7XHJcbn07XHJcblxyXG5TZXRGaWx0ZXIucHJvdG90eXBlLm9uU2VsZWN0QWxsID0gZnVuY3Rpb24oKSB7XHJcbiAgICB2YXIgY2hlY2tlZCA9IHRoaXMuZVNlbGVjdEFsbC5jaGVja2VkO1xyXG4gICAgaWYgKGNoZWNrZWQpIHtcclxuICAgICAgICB0aGlzLm1vZGVsLnNlbGVjdEV2ZXJ5dGhpbmcoKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdGhpcy5tb2RlbC5zZWxlY3ROb3RoaW5nKCk7XHJcbiAgICB9XHJcbiAgICB0aGlzLnVwZGF0ZUFsbENoZWNrYm94ZXMoY2hlY2tlZCk7XHJcbiAgICB0aGlzLmZpbHRlckNoYW5nZWRDYWxsYmFjaygpO1xyXG59O1xyXG5cclxuU2V0RmlsdGVyLnByb3RvdHlwZS51cGRhdGVBbGxDaGVja2JveGVzID0gZnVuY3Rpb24oY2hlY2tlZCkge1xyXG4gICAgdmFyIGN1cnJlbnRseURpc3BsYXllZENoZWNrYm94ZXMgPSB0aGlzLmVMaXN0Q29udGFpbmVyLnF1ZXJ5U2VsZWN0b3JBbGwoXCJbZmlsdGVyLWNoZWNrYm94PXRydWVdXCIpO1xyXG4gICAgZm9yICh2YXIgaSA9IDAsIGwgPSBjdXJyZW50bHlEaXNwbGF5ZWRDaGVja2JveGVzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xyXG4gICAgICAgIGN1cnJlbnRseURpc3BsYXllZENoZWNrYm94ZXNbaV0uY2hlY2tlZCA9IGNoZWNrZWQ7XHJcbiAgICB9XHJcbn07XHJcblxyXG5TZXRGaWx0ZXIucHJvdG90eXBlLmFkZFNjcm9sbExpc3RlbmVyID0gZnVuY3Rpb24oKSB7XHJcbiAgICB2YXIgX3RoaXMgPSB0aGlzO1xyXG5cclxuICAgIHRoaXMuZUxpc3RWaWV3cG9ydC5hZGRFdmVudExpc3RlbmVyKFwic2Nyb2xsXCIsIGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIF90aGlzLmRyYXdWaXJ0dWFsUm93cygpO1xyXG4gICAgfSk7XHJcbn07XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IFNldEZpbHRlcjtcclxuIiwiICAgIHZhciB1dGlscyA9IHJlcXVpcmUoJy4uL3V0aWxzJyk7XHJcblxyXG4gICAgZnVuY3Rpb24gU2V0RmlsdGVyTW9kZWwoY29sRGVmLCByb3dNb2RlbCkge1xyXG5cclxuICAgICAgICBpZiAoY29sRGVmLmZpbHRlclBhcmFtcyAmJiBjb2xEZWYuZmlsdGVyUGFyYW1zLnZhbHVlcykge1xyXG4gICAgICAgICAgICB0aGlzLnVuaXF1ZVZhbHVlcyA9IGNvbERlZi5maWx0ZXJQYXJhbXMudmFsdWVzO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHRoaXMuY3JlYXRlVW5pcXVlVmFsdWVzKHJvd01vZGVsLCBjb2xEZWYuZmllbGQpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKGNvbERlZi5jb21wYXJhdG9yKSB7XHJcbiAgICAgICAgICAgIHRoaXMudW5pcXVlVmFsdWVzLnNvcnQoY29sRGVmLmNvbXBhcmF0b3IpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHRoaXMudW5pcXVlVmFsdWVzLnNvcnQodXRpbHMuZGVmYXVsdENvbXBhcmF0b3IpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdGhpcy5kaXNwbGF5ZWRWYWx1ZXMgPSB0aGlzLnVuaXF1ZVZhbHVlcztcclxuICAgICAgICB0aGlzLm1pbmlGaWx0ZXIgPSBudWxsO1xyXG4gICAgICAgIC8vd2UgdXNlIGEgbWFwIHJhdGhlciB0aGFuIGFuIGFycmF5IGZvciB0aGUgc2VsZWN0ZWQgdmFsdWVzIGFzIHRoZSBsb29rdXBcclxuICAgICAgICAvL2ZvciBhIG1hcCBpcyBtdWNoIGZhc3RlciB0aGFuIHRoZSBsb29rdXAgZm9yIGFuIGFycmF5LCBlc3BlY2lhbGx5IHdoZW5cclxuICAgICAgICAvL3RoZSBsZW5ndGggb2YgdGhlIGFycmF5IGlzIHRob3VzYW5kcyBvZiByZWNvcmRzIGxvbmdcclxuICAgICAgICB0aGlzLnNlbGVjdGVkVmFsdWVzTWFwID0ge307XHJcbiAgICAgICAgdGhpcy5zZWxlY3RFdmVyeXRoaW5nKCk7XHJcbiAgICB9XHJcblxyXG4gICAgU2V0RmlsdGVyTW9kZWwucHJvdG90eXBlLmNyZWF0ZVVuaXF1ZVZhbHVlcyA9IGZ1bmN0aW9uKHJvd01vZGVsLCBrZXkpIHtcclxuICAgICAgICB2YXIgdW5pcXVlQ2hlY2sgPSB7fTtcclxuICAgICAgICB2YXIgcmVzdWx0ID0gW107XHJcbiAgICAgICAgZm9yICh2YXIgaSA9IDAsIGwgPSByb3dNb2RlbC5nZXRWaXJ0dWFsUm93Q291bnQoKTsgaSA8IGw7IGkrKykge1xyXG4gICAgICAgICAgICB2YXIgZGF0YSA9IHJvd01vZGVsLmdldFZpcnR1YWxSb3coaSkuZGF0YTtcclxuICAgICAgICAgICAgdmFyIHZhbHVlID0gZGF0YSA/IGRhdGFba2V5XSA6IG51bGw7XHJcbiAgICAgICAgICAgIGlmICh2YWx1ZSA9PT0gXCJcIiB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgICAgICB2YWx1ZSA9IG51bGw7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKCF1bmlxdWVDaGVjay5oYXNPd25Qcm9wZXJ0eSh2YWx1ZSkpIHtcclxuICAgICAgICAgICAgICAgIHJlc3VsdC5wdXNoKHZhbHVlKTtcclxuICAgICAgICAgICAgICAgIHVuaXF1ZUNoZWNrW3ZhbHVlXSA9IDE7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgdGhpcy51bmlxdWVWYWx1ZXMgPSByZXN1bHQ7XHJcbiAgICB9O1xyXG5cclxuICAgIC8vc2V0cyBtaW5pIGZpbHRlci4gcmV0dXJucyB0cnVlIGlmIGl0IGNoYW5nZWQgZnJvbSBsYXN0IHZhbHVlLCBvdGhlcndpc2UgZmFsc2VcclxuICAgIFNldEZpbHRlck1vZGVsLnByb3RvdHlwZS5zZXRNaW5pRmlsdGVyID0gZnVuY3Rpb24obmV3TWluaUZpbHRlcikge1xyXG4gICAgICAgIG5ld01pbmlGaWx0ZXIgPSB1dGlscy5tYWtlTnVsbChuZXdNaW5pRmlsdGVyKTtcclxuICAgICAgICBpZiAodGhpcy5taW5pRmlsdGVyID09PSBuZXdNaW5pRmlsdGVyKSB7XHJcbiAgICAgICAgICAgIC8vZG8gbm90aGluZyBpZiBmaWx0ZXIgaGFzIG5vdCBjaGFuZ2VkXHJcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgdGhpcy5taW5pRmlsdGVyID0gbmV3TWluaUZpbHRlcjtcclxuICAgICAgICB0aGlzLmZpbHRlckRpc3BsYXllZFZhbHVlcygpO1xyXG4gICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgfTtcclxuXHJcbiAgICBTZXRGaWx0ZXJNb2RlbC5wcm90b3R5cGUuZ2V0TWluaUZpbHRlciA9IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLm1pbmlGaWx0ZXI7XHJcbiAgICB9O1xyXG5cclxuICAgIFNldEZpbHRlck1vZGVsLnByb3RvdHlwZS5maWx0ZXJEaXNwbGF5ZWRWYWx1ZXMgPSBmdW5jdGlvbigpIHtcclxuICAgICAgICAvLyBpZiBubyBmaWx0ZXIsIGp1c3QgdXNlIHRoZSB1bmlxdWUgdmFsdWVzXHJcbiAgICAgICAgaWYgKHRoaXMubWluaUZpbHRlciA9PT0gbnVsbCkge1xyXG4gICAgICAgICAgICB0aGlzLmRpc3BsYXllZFZhbHVlcyA9IHRoaXMudW5pcXVlVmFsdWVzO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBpZiBmaWx0ZXIgcHJlc2VudCwgd2UgZmlsdGVyIGRvd24gdGhlIGxpc3RcclxuICAgICAgICB0aGlzLmRpc3BsYXllZFZhbHVlcyA9IFtdO1xyXG4gICAgICAgIHZhciBtaW5pRmlsdGVyVXBwZXJDYXNlID0gdGhpcy5taW5pRmlsdGVyLnRvVXBwZXJDYXNlKCk7XHJcbiAgICAgICAgZm9yICh2YXIgaSA9IDAsIGwgPSB0aGlzLnVuaXF1ZVZhbHVlcy5sZW5ndGg7IGkgPCBsOyBpKyspIHtcclxuICAgICAgICAgICAgdmFyIHVuaXF1ZVZhbHVlID0gdGhpcy51bmlxdWVWYWx1ZXNbaV07XHJcbiAgICAgICAgICAgIGlmICh1bmlxdWVWYWx1ZSAhPT0gbnVsbCAmJiB1bmlxdWVWYWx1ZS50b1N0cmluZygpLnRvVXBwZXJDYXNlKCkuaW5kZXhPZihtaW5pRmlsdGVyVXBwZXJDYXNlKSA+PSAwKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLmRpc3BsYXllZFZhbHVlcy5wdXNoKHVuaXF1ZVZhbHVlKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICB9O1xyXG5cclxuICAgIFNldEZpbHRlck1vZGVsLnByb3RvdHlwZS5nZXREaXNwbGF5ZWRWYWx1ZUNvdW50ID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuZGlzcGxheWVkVmFsdWVzLmxlbmd0aDtcclxuICAgIH07XHJcblxyXG4gICAgU2V0RmlsdGVyTW9kZWwucHJvdG90eXBlLmdldERpc3BsYXllZFZhbHVlID0gZnVuY3Rpb24oaW5kZXgpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5kaXNwbGF5ZWRWYWx1ZXNbaW5kZXhdO1xyXG4gICAgfTtcclxuXHJcbiAgICBTZXRGaWx0ZXJNb2RlbC5wcm90b3R5cGUuc2VsZWN0RXZlcnl0aGluZyA9IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIHZhciBjb3VudCA9IHRoaXMudW5pcXVlVmFsdWVzLmxlbmd0aDtcclxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGNvdW50OyBpKyspIHtcclxuICAgICAgICAgICAgdmFyIHZhbHVlID0gdGhpcy51bmlxdWVWYWx1ZXNbaV07XHJcbiAgICAgICAgICAgIHRoaXMuc2VsZWN0ZWRWYWx1ZXNNYXBbdmFsdWVdID0gbnVsbDtcclxuICAgICAgICB9XHJcbiAgICAgICAgdGhpcy5zZWxlY3RlZFZhbHVlc0NvdW50ID0gY291bnQ7XHJcbiAgICB9O1xyXG5cclxuICAgIFNldEZpbHRlck1vZGVsLnByb3RvdHlwZS5pc0ZpbHRlckFjdGl2ZSA9IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLnVuaXF1ZVZhbHVlcy5sZW5ndGggIT09IHRoaXMuc2VsZWN0ZWRWYWx1ZXNDb3VudDtcclxuICAgIH07XHJcblxyXG4gICAgU2V0RmlsdGVyTW9kZWwucHJvdG90eXBlLnNlbGVjdE5vdGhpbmcgPSBmdW5jdGlvbigpIHtcclxuICAgICAgICB0aGlzLnNlbGVjdGVkVmFsdWVzTWFwID0ge307XHJcbiAgICAgICAgdGhpcy5zZWxlY3RlZFZhbHVlc0NvdW50ID0gMDtcclxuICAgIH07XHJcblxyXG4gICAgU2V0RmlsdGVyTW9kZWwucHJvdG90eXBlLmdldFVuaXF1ZVZhbHVlQ291bnQgPSBmdW5jdGlvbigpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy51bmlxdWVWYWx1ZXMubGVuZ3RoO1xyXG4gICAgfTtcclxuXHJcbiAgICBTZXRGaWx0ZXJNb2RlbC5wcm90b3R5cGUudW5zZWxlY3RWYWx1ZSA9IGZ1bmN0aW9uKHZhbHVlKSB7XHJcbiAgICAgICAgaWYgKHRoaXMuc2VsZWN0ZWRWYWx1ZXNNYXBbdmFsdWVdICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgZGVsZXRlIHRoaXMuc2VsZWN0ZWRWYWx1ZXNNYXBbdmFsdWVdO1xyXG4gICAgICAgICAgICB0aGlzLnNlbGVjdGVkVmFsdWVzQ291bnQtLTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG5cclxuICAgIFNldEZpbHRlck1vZGVsLnByb3RvdHlwZS5zZWxlY3RWYWx1ZSA9IGZ1bmN0aW9uKHZhbHVlKSB7XHJcbiAgICAgICAgaWYgKHRoaXMuc2VsZWN0ZWRWYWx1ZXNNYXBbdmFsdWVdID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgdGhpcy5zZWxlY3RlZFZhbHVlc01hcFt2YWx1ZV0gPSBudWxsO1xyXG4gICAgICAgICAgICB0aGlzLnNlbGVjdGVkVmFsdWVzQ291bnQrKztcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG5cclxuICAgIFNldEZpbHRlck1vZGVsLnByb3RvdHlwZS5pc1ZhbHVlU2VsZWN0ZWQgPSBmdW5jdGlvbih2YWx1ZSkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLnNlbGVjdGVkVmFsdWVzTWFwW3ZhbHVlXSAhPT0gdW5kZWZpbmVkO1xyXG4gICAgfTtcclxuXHJcbiAgICBTZXRGaWx0ZXJNb2RlbC5wcm90b3R5cGUuaXNFdmVyeXRoaW5nU2VsZWN0ZWQgPSBmdW5jdGlvbigpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy51bmlxdWVWYWx1ZXMubGVuZ3RoID09PSB0aGlzLnNlbGVjdGVkVmFsdWVzQ291bnQ7XHJcbiAgICB9O1xyXG5cclxuICAgIFNldEZpbHRlck1vZGVsLnByb3RvdHlwZS5pc05vdGhpbmdTZWxlY3RlZCA9IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLnVuaXF1ZVZhbHVlcy5sZW5ndGggPT09IDA7XHJcbiAgICB9O1xyXG5cclxuICAgIG1vZHVsZS5leHBvcnRzID0gU2V0RmlsdGVyTW9kZWw7XHJcbiIsInZhciB0ZW1wbGF0ZSA9IFtcclxuICAgICc8ZGl2PicsXHJcbiAgICAnICAgIDxkaXYgY2xhc3M9XCJhZy1maWx0ZXItaGVhZGVyLWNvbnRhaW5lclwiPicsXHJcbiAgICAnICAgICAgICA8aW5wdXQgY2xhc3M9XCJhZy1maWx0ZXItZmlsdGVyXCIgdHlwZT1cInRleHRcIiBwbGFjZWhvbGRlcj1cInNlYXJjaC4uLlwiLz4nLFxyXG4gICAgJyAgICA8L2Rpdj4nLFxyXG4gICAgJyAgICA8ZGl2IGNsYXNzPVwiYWctZmlsdGVyLWhlYWRlci1jb250YWluZXJcIj4nLFxyXG4gICAgJyAgICAgICAgPGxhYmVsPicsXHJcbiAgICAnICAgICAgICAgICAgPGlucHV0IGlkPVwic2VsZWN0QWxsXCIgdHlwZT1cImNoZWNrYm94XCIgY2xhc3M9XCJhZy1maWx0ZXItY2hlY2tib3hcIi8+JyxcclxuICAgICcgICAgICAgICAgICAoU2VsZWN0IEFsbCknLFxyXG4gICAgJyAgICAgICAgPC9sYWJlbD4nLFxyXG4gICAgJyAgICA8L2Rpdj4nLFxyXG4gICAgJyAgICA8ZGl2IGNsYXNzPVwiYWctZmlsdGVyLWxpc3Qtdmlld3BvcnRcIj4nLFxyXG4gICAgJyAgICAgICAgPGRpdiBjbGFzcz1cImFnLWZpbHRlci1saXN0LWNvbnRhaW5lclwiPicsXHJcbiAgICAnICAgICAgICAgICAgPGRpdiBpZD1cIml0ZW1Gb3JSZXBlYXRcIiBjbGFzcz1cImFnLWZpbHRlci1pdGVtXCI+JyxcclxuICAgICcgICAgICAgICAgICAgICAgPGxhYmVsPicsXHJcbiAgICAnICAgICAgICAgICAgICAgICAgICA8aW5wdXQgdHlwZT1cImNoZWNrYm94XCIgY2xhc3M9XCJhZy1maWx0ZXItY2hlY2tib3hcIiBmaWx0ZXItY2hlY2tib3g9XCJ0cnVlXCIvPicsXHJcbiAgICAnICAgICAgICAgICAgICAgICAgICA8c3BhbiBjbGFzcz1cImFnLWZpbHRlci12YWx1ZVwiPjwvc3Bhbj4nLFxyXG4gICAgJyAgICAgICAgICAgICAgICA8L2xhYmVsPicsXHJcbiAgICAnICAgICAgICAgICAgPC9kaXY+JyxcclxuICAgICcgICAgICAgIDwvZGl2PicsXHJcbiAgICAnICAgIDwvZGl2PicsXHJcbiAgICAnPC9kaXY+JyxcclxuXS5qb2luKCcnKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gdGVtcGxhdGU7XHJcbiIsInZhciB1dGlscyA9IHJlcXVpcmUoJy4uL3V0aWxzJyk7XHJcbnZhciB0ZW1wbGF0ZSA9IHJlcXVpcmUoJy4vdGV4dEZpbHRlclRlbXBsYXRlJyk7XHJcblxyXG52YXIgQ09OVEFJTlMgPSAxO1xyXG52YXIgRVFVQUxTID0gMjtcclxudmFyIFNUQVJUU19XSVRIID0gMztcclxudmFyIEVORFNfV0lUSCA9IDQ7XHJcblxyXG5mdW5jdGlvbiBUZXh0RmlsdGVyKHBhcmFtcykge1xyXG4gICAgdGhpcy5maWx0ZXJDaGFuZ2VkQ2FsbGJhY2sgPSBwYXJhbXMuZmlsdGVyQ2hhbmdlZENhbGxiYWNrO1xyXG4gICAgdGhpcy5jcmVhdGVHdWkoKTtcclxuICAgIHRoaXMuZmlsdGVyVGV4dCA9IG51bGw7XHJcbiAgICB0aGlzLmZpbHRlclR5cGUgPSBDT05UQUlOUztcclxufVxyXG5cclxuLyogcHVibGljICovXHJcblRleHRGaWx0ZXIucHJvdG90eXBlLmFmdGVyR3VpQXR0YWNoZWQgPSBmdW5jdGlvbigpIHtcclxuICAgIHRoaXMuZUZpbHRlclRleHRGaWVsZC5mb2N1cygpO1xyXG59O1xyXG5cclxuLyogcHVibGljICovXHJcblRleHRGaWx0ZXIucHJvdG90eXBlLmRvZXNGaWx0ZXJQYXNzID0gZnVuY3Rpb24obm9kZSkge1xyXG4gICAgaWYgKCF0aGlzLmZpbHRlclRleHQpIHtcclxuICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgIH1cclxuICAgIHZhciB2YWx1ZSA9IG5vZGUudmFsdWU7XHJcbiAgICBpZiAoIXZhbHVlKSB7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gICAgdmFyIHZhbHVlTG93ZXJDYXNlID0gdmFsdWUudG9TdHJpbmcoKS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgc3dpdGNoICh0aGlzLmZpbHRlclR5cGUpIHtcclxuICAgICAgICBjYXNlIENPTlRBSU5TOlxyXG4gICAgICAgICAgICByZXR1cm4gdmFsdWVMb3dlckNhc2UuaW5kZXhPZih0aGlzLmZpbHRlclRleHQpID49IDA7XHJcbiAgICAgICAgY2FzZSBFUVVBTFM6XHJcbiAgICAgICAgICAgIHJldHVybiB2YWx1ZUxvd2VyQ2FzZSA9PT0gdGhpcy5maWx0ZXJUZXh0O1xyXG4gICAgICAgIGNhc2UgU1RBUlRTX1dJVEg6XHJcbiAgICAgICAgICAgIHJldHVybiB2YWx1ZUxvd2VyQ2FzZS5pbmRleE9mKHRoaXMuZmlsdGVyVGV4dCkgPT09IDA7XHJcbiAgICAgICAgY2FzZSBFTkRTX1dJVEg6XHJcbiAgICAgICAgICAgIHZhciBpbmRleCA9IHZhbHVlTG93ZXJDYXNlLmluZGV4T2YodGhpcy5maWx0ZXJUZXh0KTtcclxuICAgICAgICAgICAgcmV0dXJuIGluZGV4ID49IDAgJiYgaW5kZXggPT09ICh2YWx1ZUxvd2VyQ2FzZS5sZW5ndGggLSB0aGlzLmZpbHRlclRleHQubGVuZ3RoKTtcclxuICAgICAgICBkZWZhdWx0OlxyXG4gICAgICAgICAgICAvLyBzaG91bGQgbmV2ZXIgaGFwcGVuXHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdpbnZhbGlkIGZpbHRlciB0eXBlICcgKyB0aGlzLmZpbHRlclR5cGUpO1xyXG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbn07XHJcblxyXG4vKiBwdWJsaWMgKi9cclxuVGV4dEZpbHRlci5wcm90b3R5cGUuZ2V0R3VpID0gZnVuY3Rpb24oKSB7XHJcbiAgICByZXR1cm4gdGhpcy5lR3VpO1xyXG59O1xyXG5cclxuLyogcHVibGljICovXHJcblRleHRGaWx0ZXIucHJvdG90eXBlLmlzRmlsdGVyQWN0aXZlID0gZnVuY3Rpb24oKSB7XHJcbiAgICByZXR1cm4gdGhpcy5maWx0ZXJUZXh0ICE9PSBudWxsO1xyXG59O1xyXG5cclxuVGV4dEZpbHRlci5wcm90b3R5cGUuY3JlYXRlR3VpID0gZnVuY3Rpb24oKSB7XHJcbiAgICB0aGlzLmVHdWkgPSB1dGlscy5sb2FkVGVtcGxhdGUodGVtcGxhdGUpO1xyXG4gICAgdGhpcy5lRmlsdGVyVGV4dEZpZWxkID0gdGhpcy5lR3VpLnF1ZXJ5U2VsZWN0b3IoXCIjZmlsdGVyVGV4dFwiKTtcclxuICAgIHRoaXMuZVR5cGVTZWxlY3QgPSB0aGlzLmVHdWkucXVlcnlTZWxlY3RvcihcIiNmaWx0ZXJUeXBlXCIpO1xyXG5cclxuICAgIHV0aWxzLmFkZENoYW5nZUxpc3RlbmVyKHRoaXMuZUZpbHRlclRleHRGaWVsZCwgdGhpcy5vbkZpbHRlckNoYW5nZWQuYmluZCh0aGlzKSk7XHJcbiAgICB0aGlzLmVUeXBlU2VsZWN0LmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgdGhpcy5vblR5cGVDaGFuZ2VkLmJpbmQodGhpcykpO1xyXG59O1xyXG5cclxuVGV4dEZpbHRlci5wcm90b3R5cGUub25UeXBlQ2hhbmdlZCA9IGZ1bmN0aW9uKCkge1xyXG4gICAgdGhpcy5maWx0ZXJUeXBlID0gcGFyc2VJbnQodGhpcy5lVHlwZVNlbGVjdC52YWx1ZSk7XHJcbiAgICB0aGlzLmZpbHRlckNoYW5nZWRDYWxsYmFjaygpO1xyXG59O1xyXG5cclxuVGV4dEZpbHRlci5wcm90b3R5cGUub25GaWx0ZXJDaGFuZ2VkID0gZnVuY3Rpb24oKSB7XHJcbiAgICB2YXIgZmlsdGVyVGV4dCA9IHV0aWxzLm1ha2VOdWxsKHRoaXMuZUZpbHRlclRleHRGaWVsZC52YWx1ZSk7XHJcbiAgICBpZiAoZmlsdGVyVGV4dCAmJiBmaWx0ZXJUZXh0LnRyaW0oKSA9PT0gJycpIHtcclxuICAgICAgICBmaWx0ZXJUZXh0ID0gbnVsbDtcclxuICAgIH1cclxuICAgIGlmIChmaWx0ZXJUZXh0KSB7XHJcbiAgICAgICAgdGhpcy5maWx0ZXJUZXh0ID0gZmlsdGVyVGV4dC50b0xvd2VyQ2FzZSgpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICB0aGlzLmZpbHRlclRleHQgPSBudWxsO1xyXG4gICAgfVxyXG4gICAgdGhpcy5maWx0ZXJDaGFuZ2VkQ2FsbGJhY2soKTtcclxufTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gVGV4dEZpbHRlcjtcclxuIiwidmFyIHRlbXBsYXRlID0gW1xyXG4gICAgJzxkaXY+JyxcclxuICAgICc8ZGl2PicsXHJcbiAgICAnPHNlbGVjdCBjbGFzcz1cImFnLWZpbHRlci1zZWxlY3RcIiBpZD1cImZpbHRlclR5cGVcIj4nLFxyXG4gICAgJzxvcHRpb24gdmFsdWU9XCIxXCI+Q29udGFpbnM8L29wdGlvbj4nLFxyXG4gICAgJzxvcHRpb24gdmFsdWU9XCIyXCI+RXF1YWxzPC9vcHRpb24+JyxcclxuICAgICc8b3B0aW9uIHZhbHVlPVwiM1wiPlN0YXJ0cyB3aXRoPC9vcHRpb24+JyxcclxuICAgICc8b3B0aW9uIHZhbHVlPVwiNFwiPkVuZHMgd2l0aDwvb3B0aW9uPicsXHJcbiAgICAnPC9zZWxlY3Q+JyxcclxuICAgICc8L2Rpdj4nLFxyXG4gICAgJzxkaXY+JyxcclxuICAgICc8aW5wdXQgY2xhc3M9XCJhZy1maWx0ZXItZmlsdGVyXCIgaWQ9XCJmaWx0ZXJUZXh0XCIgdHlwZT1cInRleHRcIiBwbGFjZWhvbGRlcj1cImZpbHRlci4uLlwiLz4nLFxyXG4gICAgJzwvZGl2PicsXHJcbiAgICAnPC9kaXY+JyxcclxuXS5qb2luKCcnKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gdGVtcGxhdGU7XHJcbiIsInZhciBjb25zdGFudHMgPSByZXF1aXJlKCcuL2NvbnN0YW50cycpO1xyXG52YXIgR3JpZE9wdGlvbnNXcmFwcGVyID0gcmVxdWlyZSgnLi9ncmlkT3B0aW9uc1dyYXBwZXInKTtcclxudmFyIHRlbXBsYXRlID0gcmVxdWlyZSgnLi90ZW1wbGF0ZS5qcycpO1xyXG52YXIgdGVtcGxhdGVOb1Njcm9sbHMgPSByZXF1aXJlKCcuL3RlbXBsYXRlTm9TY3JvbGxzLmpzJyk7XHJcbnZhciBTZWxlY3Rpb25Db250cm9sbGVyID0gcmVxdWlyZSgnLi9zZWxlY3Rpb25Db250cm9sbGVyJyk7XHJcbnZhciBGaWx0ZXJNYW5hZ2VyID0gcmVxdWlyZSgnLi9maWx0ZXIvZmlsdGVyTWFuYWdlcicpO1xyXG52YXIgU2VsZWN0aW9uUmVuZGVyZXJGYWN0b3J5ID0gcmVxdWlyZSgnLi9zZWxlY3Rpb25SZW5kZXJlckZhY3RvcnknKTtcclxudmFyIENvbHVtbkNvbnRyb2xsZXIgPSByZXF1aXJlKCcuL2NvbHVtbkNvbnRyb2xsZXInKTtcclxudmFyIFJvd1JlbmRlcmVyID0gcmVxdWlyZSgnLi9yb3dSZW5kZXJlcicpO1xyXG52YXIgSGVhZGVyUmVuZGVyZXIgPSByZXF1aXJlKCcuL2hlYWRlclJlbmRlcmVyJyk7XHJcbnZhciBJbk1lbW9yeVJvd0NvbnRyb2xsZXIgPSByZXF1aXJlKCcuL2luTWVtb3J5Um93Q29udHJvbGxlcicpO1xyXG52YXIgVmlydHVhbFBhZ2VSb3dDb250cm9sbGVyID0gcmVxdWlyZSgnLi92aXJ0dWFsUGFnZVJvd0NvbnRyb2xsZXInKTtcclxudmFyIFBhZ2luYXRpb25Db250cm9sbGVyID0gcmVxdWlyZSgnLi9wYWdpbmF0aW9uQ29udHJvbGxlcicpO1xyXG5cclxuZnVuY3Rpb24gR3JpZChlR3JpZERpdiwgZ3JpZE9wdGlvbnMsICRzY29wZSwgJGNvbXBpbGUpIHtcclxuXHJcbiAgICB0aGlzLmdyaWRPcHRpb25zID0gZ3JpZE9wdGlvbnM7XHJcbiAgICB0aGlzLmdyaWRPcHRpb25zV3JhcHBlciA9IG5ldyBHcmlkT3B0aW9uc1dyYXBwZXIodGhpcy5ncmlkT3B0aW9ucyk7XHJcblxyXG4gICAgdmFyIHVzZVNjcm9sbHMgPSAhdGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuaXNEb250VXNlU2Nyb2xscygpO1xyXG4gICAgaWYgKHVzZVNjcm9sbHMpIHtcclxuICAgICAgICBlR3JpZERpdi5pbm5lckhUTUwgPSB0ZW1wbGF0ZTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgZUdyaWREaXYuaW5uZXJIVE1MID0gdGVtcGxhdGVOb1Njcm9sbHM7XHJcbiAgICB9XHJcblxyXG4gICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgdGhpcy5xdWlja0ZpbHRlciA9IG51bGw7XHJcblxyXG4gICAgLy8gaWYgdXNpbmcgYW5ndWxhciwgd2F0Y2ggZm9yIHF1aWNrRmlsdGVyIGNoYW5nZXNcclxuICAgIGlmICgkc2NvcGUpIHtcclxuICAgICAgICAkc2NvcGUuJHdhdGNoKFwiYW5ndWxhckdyaWQucXVpY2tGaWx0ZXJUZXh0XCIsIGZ1bmN0aW9uKG5ld0ZpbHRlcikge1xyXG4gICAgICAgICAgICB0aGF0Lm9uUXVpY2tGaWx0ZXJDaGFuZ2VkKG5ld0ZpbHRlcik7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy52aXJ0dWFsUm93Q2FsbGJhY2tzID0ge307XHJcblxyXG4gICAgdGhpcy5hZGRBcGkoKTtcclxuICAgIHRoaXMuZmluZEFsbEVsZW1lbnRzKGVHcmlkRGl2KTtcclxuICAgIHRoaXMuY3JlYXRlQW5kV2lyZUJlYW5zKCRzY29wZSwgJGNvbXBpbGUsIGVHcmlkRGl2LCB1c2VTY3JvbGxzKTtcclxuXHJcbiAgICB0aGlzLmluTWVtb3J5Um93Q29udHJvbGxlci5zZXRBbGxSb3dzKHRoaXMuZ3JpZE9wdGlvbnNXcmFwcGVyLmdldEFsbFJvd3MoKSk7XHJcblxyXG4gICAgaWYgKHVzZVNjcm9sbHMpIHtcclxuICAgICAgICB0aGlzLmFkZFNjcm9sbExpc3RlbmVyKCk7XHJcbiAgICAgICAgdGhpcy5zZXRCb2R5U2l6ZSgpOyAvL3NldHRpbmcgc2l6ZXMgb2YgYm9keSAoY29udGFpbmluZyB2aWV3cG9ydHMpLCBkb2Vzbid0IGNoYW5nZSBjb250YWluZXIgc2l6ZXNcclxuICAgIH1cclxuXHJcbiAgICAvLyBkb25lIHdoZW4gY29scyBjaGFuZ2VcclxuICAgIHRoaXMuc2V0dXBDb2x1bW5zKCk7XHJcblxyXG4gICAgLy8gZG9uZSB3aGVuIHJvd3MgY2hhbmdlXHJcbiAgICB0aGlzLnVwZGF0ZU1vZGVsQW5kUmVmcmVzaChjb25zdGFudHMuU1RFUF9FVkVSWVRISU5HKTtcclxuXHJcbiAgICAvLyBmbGFnIHRvIG1hcmsgd2hlbiB0aGUgZGlyZWN0aXZlIGlzIGRlc3Ryb3llZFxyXG4gICAgdGhpcy5maW5pc2hlZCA9IGZhbHNlO1xyXG5cclxuICAgIC8vIGlmIG5vIGRhdGEgcHJvdmlkZWQgaW5pdGlhbGx5LCBhbmQgbm90IGRvaW5nIGluZmluaXRlIHNjcm9sbGluZywgc2hvdyB0aGUgbG9hZGluZyBwYW5lbFxyXG4gICAgdmFyIHNob3dMb2FkaW5nID0gIXRoaXMuZ3JpZE9wdGlvbnNXcmFwcGVyLmdldEFsbFJvd3MoKSAmJiAhdGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuaXNWaXJ0dWFsUGFnaW5nKCk7XHJcbiAgICB0aGlzLnNob3dMb2FkaW5nUGFuZWwoc2hvd0xvYWRpbmcpO1xyXG5cclxuICAgIC8vIGlmIGRhdGFzb3VyY2UgcHJvdmlkZWQsIHVzZSBpdFxyXG4gICAgaWYgKHRoaXMuZ3JpZE9wdGlvbnNXcmFwcGVyLmdldERhdGFzb3VyY2UoKSkge1xyXG4gICAgICAgIHRoaXMuc2V0RGF0YXNvdXJjZSgpO1xyXG4gICAgfVxyXG59XHJcblxyXG5HcmlkLnByb3RvdHlwZS5jcmVhdGVBbmRXaXJlQmVhbnMgPSBmdW5jdGlvbigkc2NvcGUsICRjb21waWxlLCBlR3JpZERpdiwgdXNlU2Nyb2xscykge1xyXG5cclxuICAgIC8vIG1ha2UgbG9jYWwgcmVmZXJlbmNlcywgdG8gbWFrZSB0aGUgYmVsb3cgbW9yZSBodW1hbiByZWFkYWJsZVxyXG4gICAgdmFyIGdyaWRPcHRpb25zV3JhcHBlciA9IHRoaXMuZ3JpZE9wdGlvbnNXcmFwcGVyO1xyXG4gICAgdmFyIGdyaWRPcHRpb25zID0gdGhpcy5ncmlkT3B0aW9ucztcclxuXHJcbiAgICAvLyBjcmVhdGUgYWxsIHRoZSBiZWFuc1xyXG4gICAgdmFyIHNlbGVjdGlvbkNvbnRyb2xsZXIgPSBuZXcgU2VsZWN0aW9uQ29udHJvbGxlcigpO1xyXG4gICAgdmFyIGZpbHRlck1hbmFnZXIgPSBuZXcgRmlsdGVyTWFuYWdlcigpO1xyXG4gICAgdmFyIHNlbGVjdGlvblJlbmRlcmVyRmFjdG9yeSA9IG5ldyBTZWxlY3Rpb25SZW5kZXJlckZhY3RvcnkoKTtcclxuICAgIHZhciBjb2x1bW5Db250cm9sbGVyID0gbmV3IENvbHVtbkNvbnRyb2xsZXIoKTtcclxuICAgIHZhciByb3dSZW5kZXJlciA9IG5ldyBSb3dSZW5kZXJlcigpO1xyXG4gICAgdmFyIGhlYWRlclJlbmRlcmVyID0gbmV3IEhlYWRlclJlbmRlcmVyKCk7XHJcbiAgICB2YXIgaW5NZW1vcnlSb3dDb250cm9sbGVyID0gbmV3IEluTWVtb3J5Um93Q29udHJvbGxlcigpO1xyXG4gICAgdmFyIHZpcnR1YWxQYWdlUm93Q29udHJvbGxlciA9IG5ldyBWaXJ0dWFsUGFnZVJvd0NvbnRyb2xsZXIoKTtcclxuXHJcbiAgICB2YXIgY29sdW1uTW9kZWwgPSBjb2x1bW5Db250cm9sbGVyLmdldE1vZGVsKCk7XHJcblxyXG4gICAgLy8gaW5pdGlhbGlzZSBhbGwgdGhlIGJlYW5zXHJcbiAgICBzZWxlY3Rpb25Db250cm9sbGVyLmluaXQodGhpcywgdGhpcy5lUGFyZW50T2ZSb3dzLCBncmlkT3B0aW9uc1dyYXBwZXIsICRzY29wZSwgcm93UmVuZGVyZXIpO1xyXG4gICAgZmlsdGVyTWFuYWdlci5pbml0KHRoaXMsIGdyaWRPcHRpb25zV3JhcHBlciwgJGNvbXBpbGUsICRzY29wZSk7XHJcbiAgICBzZWxlY3Rpb25SZW5kZXJlckZhY3RvcnkuaW5pdCh0aGlzLCBzZWxlY3Rpb25Db250cm9sbGVyKTtcclxuICAgIGNvbHVtbkNvbnRyb2xsZXIuaW5pdCh0aGlzLCBzZWxlY3Rpb25SZW5kZXJlckZhY3RvcnksIGdyaWRPcHRpb25zV3JhcHBlcik7XHJcbiAgICByb3dSZW5kZXJlci5pbml0KGdyaWRPcHRpb25zLCBjb2x1bW5Nb2RlbCwgZ3JpZE9wdGlvbnNXcmFwcGVyLCBlR3JpZERpdiwgdGhpcyxcclxuICAgICAgICBzZWxlY3Rpb25SZW5kZXJlckZhY3RvcnksICRjb21waWxlLCAkc2NvcGUsIHNlbGVjdGlvbkNvbnRyb2xsZXIpO1xyXG4gICAgaGVhZGVyUmVuZGVyZXIuaW5pdChncmlkT3B0aW9uc1dyYXBwZXIsIGNvbHVtbkNvbnRyb2xsZXIsIGNvbHVtbk1vZGVsLCBlR3JpZERpdiwgdGhpcywgZmlsdGVyTWFuYWdlciwgJHNjb3BlLCAkY29tcGlsZSk7XHJcbiAgICBpbk1lbW9yeVJvd0NvbnRyb2xsZXIuaW5pdChncmlkT3B0aW9uc1dyYXBwZXIsIGNvbHVtbk1vZGVsLCB0aGlzLCBmaWx0ZXJNYW5hZ2VyLCAkc2NvcGUpO1xyXG4gICAgdmlydHVhbFBhZ2VSb3dDb250cm9sbGVyLmluaXQocm93UmVuZGVyZXIpO1xyXG5cclxuICAgIC8vIHRoaXMgaXMgYSBjaGlsZCBiZWFuLCBnZXQgYSByZWZlcmVuY2UgYW5kIHBhc3MgaXQgb25cclxuICAgIC8vIENBTiBXRSBERUxFVEUgVEhJUz8gaXQncyBkb25lIGluIHRoZSBzZXREYXRhc291cmNlIHNlY3Rpb25cclxuICAgIHZhciByb3dNb2RlbCA9IGluTWVtb3J5Um93Q29udHJvbGxlci5nZXRNb2RlbCgpO1xyXG4gICAgc2VsZWN0aW9uQ29udHJvbGxlci5zZXRSb3dNb2RlbChyb3dNb2RlbCk7XHJcbiAgICBmaWx0ZXJNYW5hZ2VyLnNldFJvd01vZGVsKHJvd01vZGVsKTtcclxuICAgIHJvd1JlbmRlcmVyLnNldFJvd01vZGVsKHJvd01vZGVsKTtcclxuXHJcbiAgICAvLyBhbmQgdGhlIGxhc3QgYmVhbiwgZG9uZSBpbiBpdCdzIG93biBzZWN0aW9uLCBhcyBpdCdzIG9wdGlvbmFsXHJcbiAgICB2YXIgcGFnaW5hdGlvbkNvbnRyb2xsZXIgPSBudWxsO1xyXG4gICAgaWYgKHVzZVNjcm9sbHMpIHtcclxuICAgICAgICBwYWdpbmF0aW9uQ29udHJvbGxlciA9IG5ldyBQYWdpbmF0aW9uQ29udHJvbGxlcigpO1xyXG4gICAgICAgIHBhZ2luYXRpb25Db250cm9sbGVyLmluaXQodGhpcy5lUGFnaW5nUGFuZWwsIHRoaXMpO1xyXG4gICAgfVxyXG5cclxuICAgIHRoaXMucm93TW9kZWwgPSByb3dNb2RlbDtcclxuICAgIHRoaXMuc2VsZWN0aW9uQ29udHJvbGxlciA9IHNlbGVjdGlvbkNvbnRyb2xsZXI7XHJcbiAgICB0aGlzLmNvbHVtbkNvbnRyb2xsZXIgPSBjb2x1bW5Db250cm9sbGVyO1xyXG4gICAgdGhpcy5jb2x1bW5Nb2RlbCA9IGNvbHVtbk1vZGVsO1xyXG4gICAgdGhpcy5pbk1lbW9yeVJvd0NvbnRyb2xsZXIgPSBpbk1lbW9yeVJvd0NvbnRyb2xsZXI7XHJcbiAgICB0aGlzLnZpcnR1YWxQYWdlUm93Q29udHJvbGxlciA9IHZpcnR1YWxQYWdlUm93Q29udHJvbGxlcjtcclxuICAgIHRoaXMucm93UmVuZGVyZXIgPSByb3dSZW5kZXJlcjtcclxuICAgIHRoaXMuaGVhZGVyUmVuZGVyZXIgPSBoZWFkZXJSZW5kZXJlcjtcclxuICAgIHRoaXMucGFnaW5hdGlvbkNvbnRyb2xsZXIgPSBwYWdpbmF0aW9uQ29udHJvbGxlcjtcclxuICAgIHRoaXMuZmlsdGVyTWFuYWdlciA9IGZpbHRlck1hbmFnZXI7XHJcbn07XHJcblxyXG5HcmlkLnByb3RvdHlwZS5zaG93QW5kUG9zaXRpb25QYWdpbmdQYW5lbCA9IGZ1bmN0aW9uKCkge1xyXG4gICAgLy8gbm8gcGFnaW5nIHdoZW4gbm8tc2Nyb2xsc1xyXG4gICAgaWYgKCF0aGlzLmVQYWdpbmdQYW5lbCkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBpZiAodGhpcy5pc1Nob3dQYWdpbmdQYW5lbCgpKSB7XHJcbiAgICAgICAgdGhpcy5lUGFnaW5nUGFuZWwuc3R5bGVbJ2Rpc3BsYXknXSA9IG51bGw7XHJcbiAgICAgICAgdmFyIGhlaWdodE9mUGFnZXIgPSB0aGlzLmVQYWdpbmdQYW5lbC5vZmZzZXRIZWlnaHQ7XHJcbiAgICAgICAgdGhpcy5lQm9keS5zdHlsZVsncGFkZGluZy1ib3R0b20nXSA9IGhlaWdodE9mUGFnZXIgKyAncHgnO1xyXG4gICAgICAgIHZhciBoZWlnaHRPZlJvb3QgPSB0aGlzLmVSb290LmNsaWVudEhlaWdodDtcclxuICAgICAgICB2YXIgdG9wT2ZQYWdlciA9IGhlaWdodE9mUm9vdCAtIGhlaWdodE9mUGFnZXI7XHJcbiAgICAgICAgdGhpcy5lUGFnaW5nUGFuZWwuc3R5bGVbJ3RvcCddID0gdG9wT2ZQYWdlciArICdweCc7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHRoaXMuZVBhZ2luZ1BhbmVsLnN0eWxlWydkaXNwbGF5J10gPSAnbm9uZSc7XHJcbiAgICAgICAgdGhpcy5lQm9keS5zdHlsZVsncGFkZGluZy1ib3R0b20nXSA9IG51bGw7XHJcbiAgICB9XHJcblxyXG59O1xyXG5cclxuR3JpZC5wcm90b3R5cGUuaXNTaG93UGFnaW5nUGFuZWwgPSBmdW5jdGlvbigpIHtcclxuICAgIHJldHVybiB0aGlzLnNob3dQYWdpbmdQYW5lbDtcclxufTtcclxuXHJcbkdyaWQucHJvdG90eXBlLnNldERhdGFzb3VyY2UgPSBmdW5jdGlvbihkYXRhc291cmNlKSB7XHJcbiAgICAvLyBpZiBkYXRhc291cmNlIHByb3ZpZGVkLCB0aGVuIHNldCBpdFxyXG4gICAgaWYgKGRhdGFzb3VyY2UpIHtcclxuICAgICAgICB0aGlzLmdyaWRPcHRpb25zLmRhdGFzb3VyY2UgPSBkYXRhc291cmNlO1xyXG4gICAgfVxyXG4gICAgLy8gZ2V0IHRoZSBzZXQgZGF0YXNvdXJjZSAoaWYgbnVsbCB3YXMgcGFzc2VkIHRvIHRoaXMgbWV0aG9kLFxyXG4gICAgLy8gdGhlbiBuZWVkIHRvIGdldCB0aGUgYWN0dWFsIGRhdGFzb3VyY2UgZnJvbSBvcHRpb25zXHJcbiAgICB2YXIgZGF0YXNvdXJjZVRvVXNlID0gdGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuZ2V0RGF0YXNvdXJjZSgpO1xyXG4gICAgdmFyIHZpcnR1YWxQYWdpbmcgPSB0aGlzLmdyaWRPcHRpb25zV3JhcHBlci5pc1ZpcnR1YWxQYWdpbmcoKSAmJiBkYXRhc291cmNlVG9Vc2U7XHJcbiAgICB2YXIgcGFnaW5hdGlvbiA9IGRhdGFzb3VyY2VUb1VzZSAmJiAhdmlydHVhbFBhZ2luZztcclxuXHJcbiAgICBpZiAodmlydHVhbFBhZ2luZykge1xyXG4gICAgICAgIHRoaXMucGFnaW5hdGlvbkNvbnRyb2xsZXIuc2V0RGF0YXNvdXJjZShudWxsKTtcclxuICAgICAgICB0aGlzLnZpcnR1YWxQYWdlUm93Q29udHJvbGxlci5zZXREYXRhc291cmNlKGRhdGFzb3VyY2VUb1VzZSk7XHJcbiAgICAgICAgdGhpcy5yb3dNb2RlbCA9IHRoaXMudmlydHVhbFBhZ2VSb3dDb250cm9sbGVyLmdldE1vZGVsKCk7XHJcbiAgICAgICAgdGhpcy5zaG93UGFnaW5nUGFuZWwgPSBmYWxzZTtcclxuICAgIH0gZWxzZSBpZiAocGFnaW5hdGlvbikge1xyXG4gICAgICAgIHRoaXMucGFnaW5hdGlvbkNvbnRyb2xsZXIuc2V0RGF0YXNvdXJjZShkYXRhc291cmNlVG9Vc2UpO1xyXG4gICAgICAgIHRoaXMudmlydHVhbFBhZ2VSb3dDb250cm9sbGVyLnNldERhdGFzb3VyY2UobnVsbCk7XHJcbiAgICAgICAgdGhpcy5yb3dNb2RlbCA9IHRoaXMuaW5NZW1vcnlSb3dDb250cm9sbGVyLmdldE1vZGVsKCk7XHJcbiAgICAgICAgdGhpcy5zaG93UGFnaW5nUGFuZWwgPSB0cnVlO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICB0aGlzLnBhZ2luYXRpb25Db250cm9sbGVyLnNldERhdGFzb3VyY2UobnVsbCk7XHJcbiAgICAgICAgdGhpcy52aXJ0dWFsUGFnZVJvd0NvbnRyb2xsZXIuc2V0RGF0YXNvdXJjZShudWxsKTtcclxuICAgICAgICB0aGlzLnJvd01vZGVsID0gdGhpcy5pbk1lbW9yeVJvd0NvbnRyb2xsZXIuZ2V0TW9kZWwoKTtcclxuICAgICAgICB0aGlzLnNob3dQYWdpbmdQYW5lbCA9IGZhbHNlO1xyXG4gICAgfVxyXG5cclxuICAgIHRoaXMuc2VsZWN0aW9uQ29udHJvbGxlci5zZXRSb3dNb2RlbCh0aGlzLnJvd01vZGVsKTtcclxuICAgIHRoaXMuZmlsdGVyTWFuYWdlci5zZXRSb3dNb2RlbCh0aGlzLnJvd01vZGVsKTtcclxuICAgIHRoaXMucm93UmVuZGVyZXIuc2V0Um93TW9kZWwodGhpcy5yb3dNb2RlbCk7XHJcblxyXG4gICAgLy8gd2UgbWF5IG9mIGp1c3Qgc2hvd24gb3IgaGlkZGVuIHRoZSBwYWdpbmcgcGFuZWwsIHNvIG5lZWRcclxuICAgIC8vIHRvIGdldCB0YWJsZSB0byBjaGVjayB0aGUgYm9keSBzaXplLCB3aGljaCBhbHNvIGhpZGVzIGFuZFxyXG4gICAgLy8gc2hvd3MgdGhlIHBhZ2luZyBwYW5lbC5cclxuICAgIHRoaXMuc2V0Qm9keVNpemUoKTtcclxuXHJcbiAgICAvLyBiZWNhdXNlIHdlIGp1c3Qgc2V0IHRoZSByb3dNb2RlbCwgbmVlZCB0byB1cGRhdGUgdGhlIGd1aVxyXG4gICAgdGhpcy5yb3dSZW5kZXJlci5yZWZyZXNoVmlldygpO1xyXG59O1xyXG5cclxuLy8gZ2V0cyBjYWxsZWQgYWZ0ZXIgY29sdW1ucyBhcmUgc2hvd24gLyBoaWRkZW4gZnJvbSBncm91cHMgZXhwYW5kaW5nXHJcbkdyaWQucHJvdG90eXBlLnJlZnJlc2hIZWFkZXJBbmRCb2R5ID0gZnVuY3Rpb24oKSB7XHJcbiAgICB0aGlzLmhlYWRlclJlbmRlcmVyLnJlZnJlc2hIZWFkZXIoKTtcclxuICAgIHRoaXMuaGVhZGVyUmVuZGVyZXIudXBkYXRlRmlsdGVySWNvbnMoKTtcclxuICAgIHRoaXMuc2V0Qm9keUNvbnRhaW5lcldpZHRoKCk7XHJcbiAgICB0aGlzLnNldFBpbm5lZENvbENvbnRhaW5lcldpZHRoKCk7XHJcbiAgICB0aGlzLnJvd1JlbmRlcmVyLnJlZnJlc2hWaWV3KCk7XHJcbn07XHJcblxyXG5HcmlkLnByb3RvdHlwZS5zZXRGaW5pc2hlZCA9IGZ1bmN0aW9uKCkge1xyXG4gICAgdGhpcy5maW5pc2hlZCA9IHRydWU7XHJcbn07XHJcblxyXG5HcmlkLnByb3RvdHlwZS5nZXRQb3B1cFBhcmVudCA9IGZ1bmN0aW9uKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuZVJvb3Q7XHJcbn07XHJcblxyXG5HcmlkLnByb3RvdHlwZS5nZXRRdWlja0ZpbHRlciA9IGZ1bmN0aW9uKCkge1xyXG4gICAgcmV0dXJuIHRoaXMucXVpY2tGaWx0ZXI7XHJcbn07XHJcblxyXG5HcmlkLnByb3RvdHlwZS5vblF1aWNrRmlsdGVyQ2hhbmdlZCA9IGZ1bmN0aW9uKG5ld0ZpbHRlcikge1xyXG4gICAgaWYgKG5ld0ZpbHRlciA9PT0gdW5kZWZpbmVkIHx8IG5ld0ZpbHRlciA9PT0gXCJcIikge1xyXG4gICAgICAgIG5ld0ZpbHRlciA9IG51bGw7XHJcbiAgICB9XHJcbiAgICBpZiAodGhpcy5xdWlja0ZpbHRlciAhPT0gbmV3RmlsdGVyKSB7XHJcbiAgICAgICAgLy93YW50ICdudWxsJyB0byBtZWFuIHRvIGZpbHRlciwgc28gcmVtb3ZlIHVuZGVmaW5lZCBhbmQgZW1wdHkgc3RyaW5nXHJcbiAgICAgICAgaWYgKG5ld0ZpbHRlciA9PT0gdW5kZWZpbmVkIHx8IG5ld0ZpbHRlciA9PT0gXCJcIikge1xyXG4gICAgICAgICAgICBuZXdGaWx0ZXIgPSBudWxsO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAobmV3RmlsdGVyICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgIG5ld0ZpbHRlciA9IG5ld0ZpbHRlci50b1VwcGVyQ2FzZSgpO1xyXG4gICAgICAgIH1cclxuICAgICAgICB0aGlzLnF1aWNrRmlsdGVyID0gbmV3RmlsdGVyO1xyXG4gICAgICAgIHRoaXMub25GaWx0ZXJDaGFuZ2VkKCk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5HcmlkLnByb3RvdHlwZS5vbkZpbHRlckNoYW5nZWQgPSBmdW5jdGlvbigpIHtcclxuICAgIHRoaXMudXBkYXRlTW9kZWxBbmRSZWZyZXNoKGNvbnN0YW50cy5TVEVQX0ZJTFRFUik7XHJcbiAgICB0aGlzLmhlYWRlclJlbmRlcmVyLnVwZGF0ZUZpbHRlckljb25zKCk7XHJcbn07XHJcblxyXG5HcmlkLnByb3RvdHlwZS5vblJvd0NsaWNrZWQgPSBmdW5jdGlvbihldmVudCwgcm93SW5kZXgsIG5vZGUpIHtcclxuXHJcbiAgICBpZiAodGhpcy5ncmlkT3B0aW9ucy5yb3dDbGlja2VkKSB7XHJcbiAgICAgICAgdmFyIHBhcmFtcyA9IHtcclxuICAgICAgICAgICAgbm9kZTogbm9kZSxcclxuICAgICAgICAgICAgZGF0YTogbm9kZS5kYXRhLFxyXG4gICAgICAgICAgICBldmVudDogZXZlbnRcclxuICAgICAgICB9O1xyXG4gICAgICAgIHRoaXMuZ3JpZE9wdGlvbnMucm93Q2xpY2tlZChwYXJhbXMpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIHdlIGRvIG5vdCBhbGxvdyBzZWxlY3RpbmcgZ3JvdXBzIGJ5IGNsaWNraW5nIChhcyB0aGUgY2xpY2sgaGVyZSBleHBhbmRzIHRoZSBncm91cClcclxuICAgIC8vIHNvIHJldHVybiBpZiBpdCdzIGEgZ3JvdXAgcm93XHJcbiAgICBpZiAobm9kZS5ncm91cCkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICAvLyBpZiBubyBzZWxlY3Rpb24gbWV0aG9kIGVuYWJsZWQsIGRvIG5vdGhpbmdcclxuICAgIGlmICghdGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuaXNSb3dTZWxlY3Rpb24oKSkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICAvLyBpZiBjbGljayBzZWxlY3Rpb24gc3VwcHJlc3NlZCwgZG8gbm90aGluZ1xyXG4gICAgaWYgKHRoaXMuZ3JpZE9wdGlvbnNXcmFwcGVyLmlzU3VwcHJlc3NSb3dDbGlja1NlbGVjdGlvbigpKSB7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIGN0cmxLZXkgZm9yIHdpbmRvd3MsIG1ldGFLZXkgZm9yIEFwcGxlXHJcbiAgICB2YXIgdHJ5TXVsdGkgPSBldmVudC5jdHJsS2V5IHx8IGV2ZW50Lm1ldGFLZXk7XHJcbiAgICB0aGlzLnNlbGVjdGlvbkNvbnRyb2xsZXIuc2VsZWN0Tm9kZShub2RlLCB0cnlNdWx0aSk7XHJcbn07XHJcblxyXG5HcmlkLnByb3RvdHlwZS5zZXRIZWFkZXJIZWlnaHQgPSBmdW5jdGlvbigpIHtcclxuICAgIHZhciBoZWFkZXJIZWlnaHQgPSB0aGlzLmdyaWRPcHRpb25zV3JhcHBlci5nZXRIZWFkZXJIZWlnaHQoKTtcclxuICAgIHZhciBoZWFkZXJIZWlnaHRQaXhlbHMgPSBoZWFkZXJIZWlnaHQgKyAncHgnO1xyXG4gICAgdmFyIGRvbnRVc2VTY3JvbGxzID0gdGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuaXNEb250VXNlU2Nyb2xscygpO1xyXG4gICAgaWYgKGRvbnRVc2VTY3JvbGxzKSB7XHJcbiAgICAgICAgdGhpcy5lSGVhZGVyQ29udGFpbmVyLnN0eWxlWydoZWlnaHQnXSA9IGhlYWRlckhlaWdodFBpeGVscztcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdGhpcy5lSGVhZGVyLnN0eWxlWydoZWlnaHQnXSA9IGhlYWRlckhlaWdodFBpeGVscztcclxuICAgICAgICB0aGlzLmVCb2R5LnN0eWxlWydwYWRkaW5nLXRvcCddID0gaGVhZGVySGVpZ2h0UGl4ZWxzO1xyXG4gICAgICAgIHRoaXMuZUxvYWRpbmdQYW5lbC5zdHlsZVsnbWFyZ2luLXRvcCddID0gaGVhZGVySGVpZ2h0UGl4ZWxzO1xyXG4gICAgfVxyXG59O1xyXG5cclxuR3JpZC5wcm90b3R5cGUuc2hvd0xvYWRpbmdQYW5lbCA9IGZ1bmN0aW9uKHNob3cpIHtcclxuICAgIGlmIChzaG93KSB7XHJcbiAgICAgICAgLy8gc2V0dGluZyBkaXNwbGF5IHRvIG51bGwsIGFjdHVhbGx5IGhhcyB0aGUgaW1wYWN0IG9mIHNldHRpbmcgaXRcclxuICAgICAgICAvLyB0byAndGFibGUnLCBhcyB0aGlzIGlzIHBhcnQgb2YgdGhlIGFnLWxvYWRpbmctcGFuZWwgY29yZSBzdHlsZVxyXG4gICAgICAgIHRoaXMuZUxvYWRpbmdQYW5lbC5zdHlsZS5kaXNwbGF5ID0gbnVsbDtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdGhpcy5lTG9hZGluZ1BhbmVsLnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7XHJcbiAgICB9XHJcbn07XHJcblxyXG5HcmlkLnByb3RvdHlwZS5zZXR1cENvbHVtbnMgPSBmdW5jdGlvbigpIHtcclxuICAgIHRoaXMuc2V0SGVhZGVySGVpZ2h0KCk7XHJcbiAgICB0aGlzLmNvbHVtbkNvbnRyb2xsZXIuc2V0Q29sdW1ucyh0aGlzLmdyaWRPcHRpb25zLmNvbHVtbkRlZnMpO1xyXG4gICAgdGhpcy5zaG93UGlubmVkQ29sQ29udGFpbmVyc0lmTmVlZGVkKCk7XHJcbiAgICB0aGlzLmhlYWRlclJlbmRlcmVyLnJlZnJlc2hIZWFkZXIoKTtcclxuICAgIGlmICghdGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuaXNEb250VXNlU2Nyb2xscygpKSB7XHJcbiAgICAgICAgdGhpcy5zZXRQaW5uZWRDb2xDb250YWluZXJXaWR0aCgpO1xyXG4gICAgICAgIHRoaXMuc2V0Qm9keUNvbnRhaW5lcldpZHRoKCk7XHJcbiAgICB9XHJcbiAgICB0aGlzLmhlYWRlclJlbmRlcmVyLnVwZGF0ZUZpbHRlckljb25zKCk7XHJcbn07XHJcblxyXG5HcmlkLnByb3RvdHlwZS5zZXRCb2R5Q29udGFpbmVyV2lkdGggPSBmdW5jdGlvbigpIHtcclxuICAgIHZhciBtYWluUm93V2lkdGggPSB0aGlzLmNvbHVtbk1vZGVsLmdldEJvZHlDb250YWluZXJXaWR0aCgpICsgXCJweFwiO1xyXG4gICAgdGhpcy5lQm9keUNvbnRhaW5lci5zdHlsZS53aWR0aCA9IG1haW5Sb3dXaWR0aDtcclxufTtcclxuXHJcbkdyaWQucHJvdG90eXBlLnVwZGF0ZU1vZGVsQW5kUmVmcmVzaCA9IGZ1bmN0aW9uKHN0ZXApIHtcclxuICAgIHRoaXMuaW5NZW1vcnlSb3dDb250cm9sbGVyLnVwZGF0ZU1vZGVsKHN0ZXApO1xyXG4gICAgdGhpcy5yb3dSZW5kZXJlci5yZWZyZXNoVmlldygpO1xyXG59O1xyXG5cclxuR3JpZC5wcm90b3R5cGUuc2V0Um93cyA9IGZ1bmN0aW9uKHJvd3MsIGZpcnN0SWQpIHtcclxuICAgIGlmIChyb3dzKSB7XHJcbiAgICAgICAgdGhpcy5ncmlkT3B0aW9ucy5yb3dEYXRhID0gcm93cztcclxuICAgIH1cclxuICAgIHRoaXMuaW5NZW1vcnlSb3dDb250cm9sbGVyLnNldEFsbFJvd3ModGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuZ2V0QWxsUm93cygpLCBmaXJzdElkKTtcclxuICAgIHRoaXMuc2VsZWN0aW9uQ29udHJvbGxlci5jbGVhclNlbGVjdGlvbigpO1xyXG4gICAgdGhpcy5maWx0ZXJNYW5hZ2VyLm9uTmV3Um93c0xvYWRlZCgpO1xyXG4gICAgdGhpcy51cGRhdGVNb2RlbEFuZFJlZnJlc2goY29uc3RhbnRzLlNURVBfRVZFUllUSElORyk7XHJcbiAgICB0aGlzLmhlYWRlclJlbmRlcmVyLnVwZGF0ZUZpbHRlckljb25zKCk7XHJcbiAgICB0aGlzLnNob3dMb2FkaW5nUGFuZWwoZmFsc2UpO1xyXG59O1xyXG5cclxuR3JpZC5wcm90b3R5cGUuYWRkQXBpID0gZnVuY3Rpb24oKSB7XHJcbiAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICB2YXIgYXBpID0ge1xyXG4gICAgICAgIHNldERhdGFzb3VyY2U6IGZ1bmN0aW9uKGRhdGFzb3VyY2UpIHtcclxuICAgICAgICAgICAgdGhhdC5zZXREYXRhc291cmNlKGRhdGFzb3VyY2UpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgb25OZXdEYXRhc291cmNlOiBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgdGhhdC5zZXREYXRhc291cmNlKCk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBzZXRSb3dzOiBmdW5jdGlvbihyb3dzKSB7XHJcbiAgICAgICAgICAgIHRoYXQuc2V0Um93cyhyb3dzKTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIG9uTmV3Um93czogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHRoYXQuc2V0Um93cygpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgb25OZXdDb2xzOiBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgdGhhdC5vbk5ld0NvbHMoKTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIHVuc2VsZWN0QWxsOiBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgdGhhdC5zZWxlY3Rpb25Db250cm9sbGVyLmNsZWFyU2VsZWN0aW9uKCk7XHJcbiAgICAgICAgICAgIHRoYXQucm93UmVuZGVyZXIucmVmcmVzaFZpZXcoKTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIHJlZnJlc2hWaWV3OiBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgdGhhdC5yb3dSZW5kZXJlci5yZWZyZXNoVmlldygpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgcmVmcmVzaEhlYWRlcjogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIC8vIG5lZWQgdG8gcmV2aWV3IHRoaXMgLSB0aGUgcmVmcmVzaEhlYWRlciBzaG91bGQgYWxzbyByZWZyZXNoIGFsbCBpY29ucyBpbiB0aGUgaGVhZGVyXHJcbiAgICAgICAgICAgIHRoYXQuaGVhZGVyUmVuZGVyZXIucmVmcmVzaEhlYWRlcigpO1xyXG4gICAgICAgICAgICB0aGF0LmhlYWRlclJlbmRlcmVyLnVwZGF0ZUZpbHRlckljb25zKCk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBnZXRNb2RlbDogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGF0LnJvd01vZGVsO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgb25Hcm91cEV4cGFuZGVkT3JDb2xsYXBzZWQ6IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICB0aGF0LnVwZGF0ZU1vZGVsQW5kUmVmcmVzaChjb25zdGFudHMuU1RFUF9NQVApO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgZXhwYW5kQWxsOiBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgdGhhdC5pbk1lbW9yeVJvd0NvbnRyb2xsZXIuZXhwYW5kT3JDb2xsYXBzZUFsbCh0cnVlLCBudWxsKTtcclxuICAgICAgICAgICAgdGhhdC51cGRhdGVNb2RlbEFuZFJlZnJlc2goY29uc3RhbnRzLlNURVBfTUFQKTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIGNvbGxhcHNlQWxsOiBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgdGhhdC5pbk1lbW9yeVJvd0NvbnRyb2xsZXIuZXhwYW5kT3JDb2xsYXBzZUFsbChmYWxzZSwgbnVsbCk7XHJcbiAgICAgICAgICAgIHRoYXQudXBkYXRlTW9kZWxBbmRSZWZyZXNoKGNvbnN0YW50cy5TVEVQX01BUCk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBhZGRWaXJ0dWFsUm93TGlzdGVuZXI6IGZ1bmN0aW9uKHJvd0luZGV4LCBjYWxsYmFjaykge1xyXG4gICAgICAgICAgICB0aGF0LmFkZFZpcnR1YWxSb3dMaXN0ZW5lcihyb3dJbmRleCwgY2FsbGJhY2spO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgcm93RGF0YUNoYW5nZWQ6IGZ1bmN0aW9uKHJvd3MpIHtcclxuICAgICAgICAgICAgdGhhdC5yb3dSZW5kZXJlci5yb3dEYXRhQ2hhbmdlZChyb3dzKTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIHNldFF1aWNrRmlsdGVyOiBmdW5jdGlvbihuZXdGaWx0ZXIpIHtcclxuICAgICAgICAgICAgdGhhdC5vblF1aWNrRmlsdGVyQ2hhbmdlZChuZXdGaWx0ZXIpXHJcbiAgICAgICAgfSxcclxuICAgICAgICBzZWxlY3RJbmRleDogZnVuY3Rpb24oaW5kZXgsIHRyeU11bHRpLCBzdXBwcmVzc0V2ZW50cykge1xyXG4gICAgICAgICAgICB0aGF0LnNlbGVjdGlvbkNvbnRyb2xsZXIuc2VsZWN0SW5kZXgoaW5kZXgsIHRyeU11bHRpLCBzdXBwcmVzc0V2ZW50cyk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBkZXNlbGVjdEluZGV4OiBmdW5jdGlvbihpbmRleCkge1xyXG4gICAgICAgICAgICB0aGF0LnNlbGVjdGlvbkNvbnRyb2xsZXIuZGVzZWxlY3RJbmRleChpbmRleCk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBzZWxlY3ROb2RlOiBmdW5jdGlvbihub2RlLCB0cnlNdWx0aSwgc3VwcHJlc3NFdmVudHMpIHtcclxuICAgICAgICAgICAgdGhhdC5zZWxlY3Rpb25Db250cm9sbGVyLnNlbGVjdE5vZGUobm9kZSwgdHJ5TXVsdGksIHN1cHByZXNzRXZlbnRzKTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIGRlc2VsZWN0Tm9kZTogZnVuY3Rpb24obm9kZSkge1xyXG4gICAgICAgICAgICB0aGF0LnNlbGVjdGlvbkNvbnRyb2xsZXIuZGVzZWxlY3ROb2RlKG5vZGUpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgcmVjb21wdXRlQWdncmVnYXRlczogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHRoYXQuaW5NZW1vcnlSb3dDb250cm9sbGVyLmRvQWdncmVnYXRlKCk7XHJcbiAgICAgICAgICAgIHRoYXQucm93UmVuZGVyZXIucmVmcmVzaEdyb3VwUm93cygpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgc2l6ZUNvbHVtbnNUb0ZpdDogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHZhciBhdmFpbGFibGVXaWR0aCA9IHRoYXQuZUJvZHkuY2xpZW50V2lkdGg7XHJcbiAgICAgICAgICAgIHRoYXQuY29sdW1uQ29udHJvbGxlci5zaXplQ29sdW1uc1RvRml0KGF2YWlsYWJsZVdpZHRoKTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIHNob3dMb2FkaW5nOiBmdW5jdGlvbihzaG93KSB7XHJcbiAgICAgICAgICAgIHRoYXQuc2hvd0xvYWRpbmdQYW5lbChzaG93KTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIGlzTm9kZVNlbGVjdGVkOiBmdW5jdGlvbihub2RlKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGF0LnNlbGVjdGlvbkNvbnRyb2xsZXIuaXNOb2RlU2VsZWN0ZWQobm9kZSk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBnZXRTZWxlY3RlZE5vZGVzOiBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRoYXQuc2VsZWN0aW9uQ29udHJvbGxlci5nZXRTZWxlY3RlZE5vZGVzKCk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBnZXRCZXN0Q29zdE5vZGVTZWxlY3Rpb246IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICByZXR1cm4gdGhhdC5zZWxlY3Rpb25Db250cm9sbGVyLmdldEJlc3RDb3N0Tm9kZVNlbGVjdGlvbigpO1xyXG4gICAgICAgIH1cclxuICAgIH07XHJcbiAgICB0aGlzLmdyaWRPcHRpb25zLmFwaSA9IGFwaTtcclxufTtcclxuXHJcbkdyaWQucHJvdG90eXBlLmFkZFZpcnR1YWxSb3dMaXN0ZW5lciA9IGZ1bmN0aW9uKHJvd0luZGV4LCBjYWxsYmFjaykge1xyXG4gICAgaWYgKCF0aGlzLnZpcnR1YWxSb3dDYWxsYmFja3Nbcm93SW5kZXhdKSB7XHJcbiAgICAgICAgdGhpcy52aXJ0dWFsUm93Q2FsbGJhY2tzW3Jvd0luZGV4XSA9IFtdO1xyXG4gICAgfVxyXG4gICAgdGhpcy52aXJ0dWFsUm93Q2FsbGJhY2tzW3Jvd0luZGV4XS5wdXNoKGNhbGxiYWNrKTtcclxufTtcclxuXHJcbkdyaWQucHJvdG90eXBlLm9uVmlydHVhbFJvd1NlbGVjdGVkID0gZnVuY3Rpb24ocm93SW5kZXgsIHNlbGVjdGVkKSB7XHJcbiAgICAvLyBpbmZvcm0gdGhlIGNhbGxiYWNrcyBvZiB0aGUgZXZlbnRcclxuICAgIGlmICh0aGlzLnZpcnR1YWxSb3dDYWxsYmFja3Nbcm93SW5kZXhdKSB7XHJcbiAgICAgICAgdGhpcy52aXJ0dWFsUm93Q2FsbGJhY2tzW3Jvd0luZGV4XS5mb3JFYWNoKGZ1bmN0aW9uKGNhbGxiYWNrKSB7XHJcbiAgICAgICAgICAgIGlmICh0eXBlb2YgY2FsbGJhY2sucm93UmVtb3ZlZCA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICAgICAgICAgICAgY2FsbGJhY2sucm93U2VsZWN0ZWQoc2VsZWN0ZWQpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5HcmlkLnByb3RvdHlwZS5vblZpcnR1YWxSb3dSZW1vdmVkID0gZnVuY3Rpb24ocm93SW5kZXgpIHtcclxuICAgIC8vIGluZm9ybSB0aGUgY2FsbGJhY2tzIG9mIHRoZSBldmVudFxyXG4gICAgaWYgKHRoaXMudmlydHVhbFJvd0NhbGxiYWNrc1tyb3dJbmRleF0pIHtcclxuICAgICAgICB0aGlzLnZpcnR1YWxSb3dDYWxsYmFja3Nbcm93SW5kZXhdLmZvckVhY2goZnVuY3Rpb24oY2FsbGJhY2spIHtcclxuICAgICAgICAgICAgaWYgKHR5cGVvZiBjYWxsYmFjay5yb3dSZW1vdmVkID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgICAgICAgICBjYWxsYmFjay5yb3dSZW1vdmVkKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgIH1cclxuICAgIC8vIHJlbW92ZSB0aGUgY2FsbGJhY2tzXHJcbiAgICBkZWxldGUgdGhpcy52aXJ0dWFsUm93Q2FsbGJhY2tzW3Jvd0luZGV4XTtcclxufTtcclxuXHJcbkdyaWQucHJvdG90eXBlLm9uTmV3Q29scyA9IGZ1bmN0aW9uKCkge1xyXG4gICAgdGhpcy5zZXR1cENvbHVtbnMoKTtcclxuICAgIHRoaXMudXBkYXRlTW9kZWxBbmRSZWZyZXNoKGNvbnN0YW50cy5TVEVQX0VWRVJZVEhJTkcpO1xyXG59O1xyXG5cclxuR3JpZC5wcm90b3R5cGUuZmluZEFsbEVsZW1lbnRzID0gZnVuY3Rpb24oZUdyaWREaXYpIHtcclxuICAgIGlmICh0aGlzLmdyaWRPcHRpb25zV3JhcHBlci5pc0RvbnRVc2VTY3JvbGxzKCkpIHtcclxuICAgICAgICB0aGlzLmVSb290ID0gZUdyaWREaXYucXVlcnlTZWxlY3RvcihcIi5hZy1yb290XCIpO1xyXG4gICAgICAgIHRoaXMuZUhlYWRlckNvbnRhaW5lciA9IGVHcmlkRGl2LnF1ZXJ5U2VsZWN0b3IoXCIuYWctaGVhZGVyLWNvbnRhaW5lclwiKTtcclxuICAgICAgICB0aGlzLmVCb2R5Q29udGFpbmVyID0gZUdyaWREaXYucXVlcnlTZWxlY3RvcihcIi5hZy1ib2R5LWNvbnRhaW5lclwiKTtcclxuICAgICAgICB0aGlzLmVMb2FkaW5nUGFuZWwgPSBlR3JpZERpdi5xdWVyeVNlbGVjdG9yKCcuYWctbG9hZGluZy1wYW5lbCcpO1xyXG4gICAgICAgIC8vIGZvciBuby1zY3JvbGxzLCBhbGwgcm93cyBsaXZlIGluIHRoZSBib2R5IGNvbnRhaW5lclxyXG4gICAgICAgIHRoaXMuZVBhcmVudE9mUm93cyA9IHRoaXMuZUJvZHlDb250YWluZXI7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHRoaXMuZVJvb3QgPSBlR3JpZERpdi5xdWVyeVNlbGVjdG9yKFwiLmFnLXJvb3RcIik7XHJcbiAgICAgICAgdGhpcy5lQm9keSA9IGVHcmlkRGl2LnF1ZXJ5U2VsZWN0b3IoXCIuYWctYm9keVwiKTtcclxuICAgICAgICB0aGlzLmVCb2R5Q29udGFpbmVyID0gZUdyaWREaXYucXVlcnlTZWxlY3RvcihcIi5hZy1ib2R5LWNvbnRhaW5lclwiKTtcclxuICAgICAgICB0aGlzLmVCb2R5Vmlld3BvcnQgPSBlR3JpZERpdi5xdWVyeVNlbGVjdG9yKFwiLmFnLWJvZHktdmlld3BvcnRcIik7XHJcbiAgICAgICAgdGhpcy5lQm9keVZpZXdwb3J0V3JhcHBlciA9IGVHcmlkRGl2LnF1ZXJ5U2VsZWN0b3IoXCIuYWctYm9keS12aWV3cG9ydC13cmFwcGVyXCIpO1xyXG4gICAgICAgIHRoaXMuZVBpbm5lZENvbHNDb250YWluZXIgPSBlR3JpZERpdi5xdWVyeVNlbGVjdG9yKFwiLmFnLXBpbm5lZC1jb2xzLWNvbnRhaW5lclwiKTtcclxuICAgICAgICB0aGlzLmVQaW5uZWRDb2xzVmlld3BvcnQgPSBlR3JpZERpdi5xdWVyeVNlbGVjdG9yKFwiLmFnLXBpbm5lZC1jb2xzLXZpZXdwb3J0XCIpO1xyXG4gICAgICAgIHRoaXMuZVBpbm5lZEhlYWRlciA9IGVHcmlkRGl2LnF1ZXJ5U2VsZWN0b3IoXCIuYWctcGlubmVkLWhlYWRlclwiKTtcclxuICAgICAgICB0aGlzLmVIZWFkZXIgPSBlR3JpZERpdi5xdWVyeVNlbGVjdG9yKFwiLmFnLWhlYWRlclwiKTtcclxuICAgICAgICB0aGlzLmVIZWFkZXJDb250YWluZXIgPSBlR3JpZERpdi5xdWVyeVNlbGVjdG9yKFwiLmFnLWhlYWRlci1jb250YWluZXJcIik7XHJcbiAgICAgICAgdGhpcy5lTG9hZGluZ1BhbmVsID0gZUdyaWREaXYucXVlcnlTZWxlY3RvcignLmFnLWxvYWRpbmctcGFuZWwnKTtcclxuICAgICAgICAvLyBmb3Igc2Nyb2xscywgYWxsIHJvd3MgbGl2ZSBpbiBlQm9keSAoY29udGFpbmluZyBwaW5uZWQgYW5kIG5vcm1hbCBib2R5KVxyXG4gICAgICAgIHRoaXMuZVBhcmVudE9mUm93cyA9IHRoaXMuZUJvZHk7XHJcbiAgICAgICAgdGhpcy5lUGFnaW5nUGFuZWwgPSBlR3JpZERpdi5xdWVyeVNlbGVjdG9yKCcuYWctcGFnaW5nLXBhbmVsJyk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5HcmlkLnByb3RvdHlwZS5zaG93UGlubmVkQ29sQ29udGFpbmVyc0lmTmVlZGVkID0gZnVuY3Rpb24oKSB7XHJcbiAgICAvLyBubyBuZWVkIHRvIGRvIHRoaXMgaWYgbm90IHVzaW5nIHNjcm9sbHNcclxuICAgIGlmICh0aGlzLmdyaWRPcHRpb25zV3JhcHBlci5pc0RvbnRVc2VTY3JvbGxzKCkpIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgdmFyIHNob3dpbmdQaW5uZWRDb2xzID0gdGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuZ2V0UGlubmVkQ29sQ291bnQoKSA+IDA7XHJcblxyXG4gICAgLy9zb21lIGJyb3dzZXJzIGhhZCBsYXlvdXQgaXNzdWVzIHdpdGggdGhlIGJsYW5rIGRpdnMsIHNvIGlmIGJsYW5rLFxyXG4gICAgLy93ZSBkb24ndCBkaXNwbGF5IHRoZW1cclxuICAgIGlmIChzaG93aW5nUGlubmVkQ29scykge1xyXG4gICAgICAgIHRoaXMuZVBpbm5lZEhlYWRlci5zdHlsZS5kaXNwbGF5ID0gJ2lubGluZS1ibG9jayc7XHJcbiAgICAgICAgdGhpcy5lUGlubmVkQ29sc1ZpZXdwb3J0LnN0eWxlLmRpc3BsYXkgPSAnaW5saW5lJztcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdGhpcy5lUGlubmVkSGVhZGVyLnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7XHJcbiAgICAgICAgdGhpcy5lUGlubmVkQ29sc1ZpZXdwb3J0LnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7XHJcbiAgICB9XHJcbn07XHJcblxyXG5HcmlkLnByb3RvdHlwZS51cGRhdGVCb2R5Q29udGFpbmVyV2lkdGhBZnRlckNvbFJlc2l6ZSA9IGZ1bmN0aW9uKCkge1xyXG4gICAgdGhpcy5yb3dSZW5kZXJlci5zZXRNYWluUm93V2lkdGhzKCk7XHJcbiAgICB0aGlzLnNldEJvZHlDb250YWluZXJXaWR0aCgpO1xyXG59O1xyXG5cclxuR3JpZC5wcm90b3R5cGUudXBkYXRlUGlubmVkQ29sQ29udGFpbmVyV2lkdGhBZnRlckNvbFJlc2l6ZSA9IGZ1bmN0aW9uKCkge1xyXG4gICAgdGhpcy5zZXRQaW5uZWRDb2xDb250YWluZXJXaWR0aCgpO1xyXG59O1xyXG5cclxuR3JpZC5wcm90b3R5cGUuc2V0UGlubmVkQ29sQ29udGFpbmVyV2lkdGggPSBmdW5jdGlvbigpIHtcclxuICAgIHZhciBwaW5uZWRDb2xXaWR0aCA9IHRoaXMuY29sdW1uTW9kZWwuZ2V0UGlubmVkQ29udGFpbmVyV2lkdGgoKSArIFwicHhcIjtcclxuICAgIHRoaXMuZVBpbm5lZENvbHNDb250YWluZXIuc3R5bGUud2lkdGggPSBwaW5uZWRDb2xXaWR0aDtcclxuICAgIHRoaXMuZUJvZHlWaWV3cG9ydFdyYXBwZXIuc3R5bGUubWFyZ2luTGVmdCA9IHBpbm5lZENvbFdpZHRoO1xyXG59O1xyXG5cclxuLy8gc2VlIGlmIGEgZ3JleSBib3ggaXMgbmVlZGVkIGF0IHRoZSBib3R0b20gb2YgdGhlIHBpbm5lZCBjb2xcclxuR3JpZC5wcm90b3R5cGUuc2V0UGlubmVkQ29sSGVpZ2h0ID0gZnVuY3Rpb24oKSB7XHJcbiAgICAvLyB2YXIgYm9keUhlaWdodCA9IHV0aWxzLnBpeGVsU3RyaW5nVG9OdW1iZXIodGhpcy5lQm9keS5zdHlsZS5oZWlnaHQpO1xyXG4gICAgdmFyIHNjcm9sbFNob3dpbmcgPSB0aGlzLmVCb2R5Vmlld3BvcnQuY2xpZW50V2lkdGggPCB0aGlzLmVCb2R5Vmlld3BvcnQuc2Nyb2xsV2lkdGg7XHJcbiAgICB2YXIgYm9keUhlaWdodCA9IHRoaXMuZUJvZHlWaWV3cG9ydC5vZmZzZXRIZWlnaHQ7XHJcbiAgICBpZiAoc2Nyb2xsU2hvd2luZykge1xyXG4gICAgICAgIHRoaXMuZVBpbm5lZENvbHNWaWV3cG9ydC5zdHlsZS5oZWlnaHQgPSAoYm9keUhlaWdodCAtIDIwKSArIFwicHhcIjtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdGhpcy5lUGlubmVkQ29sc1ZpZXdwb3J0LnN0eWxlLmhlaWdodCA9IGJvZHlIZWlnaHQgKyBcInB4XCI7XHJcbiAgICB9XHJcbiAgICAvLyBhbHNvIHRoZSBsb2FkaW5nIG92ZXJsYXksIG5lZWRzIHRvIGhhdmUgaXQncyBoZWlnaHQgYWRqdXN0ZWRcclxuICAgIHRoaXMuZUxvYWRpbmdQYW5lbC5zdHlsZS5oZWlnaHQgPSBib2R5SGVpZ2h0ICsgJ3B4JztcclxufTtcclxuXHJcbkdyaWQucHJvdG90eXBlLnNldEJvZHlTaXplID0gZnVuY3Rpb24oKSB7XHJcbiAgICB2YXIgX3RoaXMgPSB0aGlzO1xyXG5cclxuICAgIHZhciBib2R5SGVpZ2h0ID0gdGhpcy5lQm9keVZpZXdwb3J0Lm9mZnNldEhlaWdodDtcclxuICAgIHZhciBwYWdpbmdWaXNpYmxlID0gdGhpcy5pc1Nob3dQYWdpbmdQYW5lbCgpO1xyXG5cclxuICAgIGlmICh0aGlzLmJvZHlIZWlnaHRMYXN0VGltZSAhPSBib2R5SGVpZ2h0IHx8IHRoaXMuc2hvd1BhZ2luZ1BhbmVsVmlzaWJsZUxhc3RUaW1lICE9IHBhZ2luZ1Zpc2libGUpIHtcclxuICAgICAgICB0aGlzLmJvZHlIZWlnaHRMYXN0VGltZSA9IGJvZHlIZWlnaHQ7XHJcbiAgICAgICAgdGhpcy5zaG93UGFnaW5nUGFuZWxWaXNpYmxlTGFzdFRpbWUgPSBwYWdpbmdWaXNpYmxlO1xyXG5cclxuICAgICAgICB0aGlzLnNldFBpbm5lZENvbEhlaWdodCgpO1xyXG5cclxuICAgICAgICAvL29ubHkgZHJhdyB2aXJ0dWFsIHJvd3MgaWYgZG9uZSBzb3J0ICYgZmlsdGVyIC0gdGhpc1xyXG4gICAgICAgIC8vbWVhbnMgd2UgZG9uJ3QgZHJhdyByb3dzIGlmIHRhYmxlIGlzIG5vdCB5ZXQgaW5pdGlhbGlzZWRcclxuICAgICAgICBpZiAodGhpcy5yb3dNb2RlbC5nZXRWaXJ0dWFsUm93Q291bnQoKSA+IDApIHtcclxuICAgICAgICAgICAgdGhpcy5yb3dSZW5kZXJlci5kcmF3VmlydHVhbFJvd3MoKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIHNob3cgYW5kIHBvc2l0aW9uIHBhZ2luZyBwYW5lbFxyXG4gICAgICAgIHRoaXMuc2hvd0FuZFBvc2l0aW9uUGFnaW5nUGFuZWwoKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIXRoaXMuZmluaXNoZWQpIHtcclxuICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICBfdGhpcy5zZXRCb2R5U2l6ZSgpO1xyXG4gICAgICAgIH0sIDIwMCk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5HcmlkLnByb3RvdHlwZS5hZGRTY3JvbGxMaXN0ZW5lciA9IGZ1bmN0aW9uKCkge1xyXG4gICAgdmFyIF90aGlzID0gdGhpcztcclxuXHJcbiAgICB0aGlzLmVCb2R5Vmlld3BvcnQuYWRkRXZlbnRMaXN0ZW5lcihcInNjcm9sbFwiLCBmdW5jdGlvbigpIHtcclxuICAgICAgICBfdGhpcy5zY3JvbGxIZWFkZXJBbmRQaW5uZWQoKTtcclxuICAgICAgICBfdGhpcy5yb3dSZW5kZXJlci5kcmF3VmlydHVhbFJvd3MoKTtcclxuICAgIH0pO1xyXG59O1xyXG5cclxuR3JpZC5wcm90b3R5cGUuc2Nyb2xsSGVhZGVyQW5kUGlubmVkID0gZnVuY3Rpb24oKSB7XHJcbiAgICB0aGlzLmVIZWFkZXJDb250YWluZXIuc3R5bGUubGVmdCA9IC10aGlzLmVCb2R5Vmlld3BvcnQuc2Nyb2xsTGVmdCArIFwicHhcIjtcclxuICAgIHRoaXMuZVBpbm5lZENvbHNDb250YWluZXIuc3R5bGUudG9wID0gLXRoaXMuZUJvZHlWaWV3cG9ydC5zY3JvbGxUb3AgKyBcInB4XCI7XHJcbn07XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEdyaWQ7XHJcbiIsInZhciBERUZBVUxUX1JPV19IRUlHSFQgPSAzMDtcclxuXHJcbmZ1bmN0aW9uIEdyaWRPcHRpb25zV3JhcHBlcihncmlkT3B0aW9ucykge1xyXG4gICAgdGhpcy5ncmlkT3B0aW9ucyA9IGdyaWRPcHRpb25zO1xyXG4gICAgdGhpcy5zZXR1cERlZmF1bHRzKCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlzVHJ1ZSh2YWx1ZSkge1xyXG4gICAgcmV0dXJuIHZhbHVlID09PSB0cnVlIHx8IHZhbHVlID09PSAndHJ1ZSc7XHJcbn1cclxuXHJcbkdyaWRPcHRpb25zV3JhcHBlci5wcm90b3R5cGUuaXNSb3dTZWxlY3Rpb24gPSBmdW5jdGlvbigpIHtcclxuICAgIHJldHVybiB0aGlzLmdyaWRPcHRpb25zLnJvd1NlbGVjdGlvbiA9PT0gXCJzaW5nbGVcIiB8fCB0aGlzLmdyaWRPcHRpb25zLnJvd1NlbGVjdGlvbiA9PT0gXCJtdWx0aXBsZVwiO1xyXG59O1xyXG5HcmlkT3B0aW9uc1dyYXBwZXIucHJvdG90eXBlLmlzUm93U2VsZWN0aW9uTXVsdGkgPSBmdW5jdGlvbigpIHtcclxuICAgIHJldHVybiB0aGlzLmdyaWRPcHRpb25zLnJvd1NlbGVjdGlvbiA9PT0gJ211bHRpcGxlJztcclxufTtcclxuR3JpZE9wdGlvbnNXcmFwcGVyLnByb3RvdHlwZS5nZXRDb250ZXh0ID0gZnVuY3Rpb24oKSB7XHJcbiAgICByZXR1cm4gdGhpcy5ncmlkT3B0aW9ucy5jb250ZXh0O1xyXG59O1xyXG5HcmlkT3B0aW9uc1dyYXBwZXIucHJvdG90eXBlLmlzVmlydHVhbFBhZ2luZyA9IGZ1bmN0aW9uKCkge1xyXG4gICAgcmV0dXJuIGlzVHJ1ZSh0aGlzLmdyaWRPcHRpb25zLnZpcnR1YWxQYWdpbmcpO1xyXG59O1xyXG5HcmlkT3B0aW9uc1dyYXBwZXIucHJvdG90eXBlLmlzUm93c0FscmVhZHlHcm91cGVkID0gZnVuY3Rpb24oKSB7XHJcbiAgICByZXR1cm4gaXNUcnVlKHRoaXMuZ3JpZE9wdGlvbnMucm93c0FscmVhZHlHcm91cGVkKTtcclxufTtcclxuR3JpZE9wdGlvbnNXcmFwcGVyLnByb3RvdHlwZS5pc0dyb3VwQ2hlY2tib3hTZWxlY3Rpb25Hcm91cCA9IGZ1bmN0aW9uKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuZ3JpZE9wdGlvbnMuZ3JvdXBDaGVja2JveFNlbGVjdGlvbiA9PT0gJ2dyb3VwJztcclxufTtcclxuR3JpZE9wdGlvbnNXcmFwcGVyLnByb3RvdHlwZS5pc0dyb3VwQ2hlY2tib3hTZWxlY3Rpb25DaGlsZHJlbiA9IGZ1bmN0aW9uKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuZ3JpZE9wdGlvbnMuZ3JvdXBDaGVja2JveFNlbGVjdGlvbiA9PT0gJ2NoaWxkcmVuJztcclxufTtcclxuR3JpZE9wdGlvbnNXcmFwcGVyLnByb3RvdHlwZS5pc0dyb3VwSW5jbHVkZUZvb3RlciA9IGZ1bmN0aW9uKCkge1xyXG4gICAgcmV0dXJuIGlzVHJ1ZSh0aGlzLmdyaWRPcHRpb25zLmdyb3VwSW5jbHVkZUZvb3Rlcik7XHJcbn07XHJcbkdyaWRPcHRpb25zV3JhcHBlci5wcm90b3R5cGUuaXNTdXBwcmVzc1Jvd0NsaWNrU2VsZWN0aW9uID0gZnVuY3Rpb24oKSB7XHJcbiAgICByZXR1cm4gaXNUcnVlKHRoaXMuZ3JpZE9wdGlvbnMuc3VwcHJlc3NSb3dDbGlja1NlbGVjdGlvbik7XHJcbn07XHJcbkdyaWRPcHRpb25zV3JhcHBlci5wcm90b3R5cGUuaXNHcm91cEhlYWRlcnMgPSBmdW5jdGlvbigpIHtcclxuICAgIHJldHVybiBpc1RydWUodGhpcy5ncmlkT3B0aW9ucy5ncm91cEhlYWRlcnMpO1xyXG59O1xyXG5HcmlkT3B0aW9uc1dyYXBwZXIucHJvdG90eXBlLmlzRG9udFVzZVNjcm9sbHMgPSBmdW5jdGlvbigpIHtcclxuICAgIHJldHVybiBpc1RydWUodGhpcy5ncmlkT3B0aW9ucy5kb250VXNlU2Nyb2xscyk7XHJcbn07XHJcbkdyaWRPcHRpb25zV3JhcHBlci5wcm90b3R5cGUuZ2V0Um93U3R5bGUgPSBmdW5jdGlvbigpIHtcclxuICAgIHJldHVybiB0aGlzLmdyaWRPcHRpb25zLnJvd1N0eWxlO1xyXG59O1xyXG5HcmlkT3B0aW9uc1dyYXBwZXIucHJvdG90eXBlLmdldFJvd0NsYXNzID0gZnVuY3Rpb24oKSB7XHJcbiAgICByZXR1cm4gdGhpcy5ncmlkT3B0aW9ucy5yb3dDbGFzcztcclxufTtcclxuR3JpZE9wdGlvbnNXcmFwcGVyLnByb3RvdHlwZS5nZXRHcmlkT3B0aW9ucyA9IGZ1bmN0aW9uKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuZ3JpZE9wdGlvbnM7XHJcbn07XHJcbkdyaWRPcHRpb25zV3JhcHBlci5wcm90b3R5cGUuZ2V0SGVhZGVyQ2VsbFJlbmRlcmVyID0gZnVuY3Rpb24oKSB7XHJcbiAgICByZXR1cm4gdGhpcy5ncmlkT3B0aW9ucy5oZWFkZXJDZWxsUmVuZGVyZXI7XHJcbn07XHJcbkdyaWRPcHRpb25zV3JhcHBlci5wcm90b3R5cGUuaXNFbmFibGVTb3J0aW5nID0gZnVuY3Rpb24oKSB7XHJcbiAgICByZXR1cm4gdGhpcy5ncmlkT3B0aW9ucy5lbmFibGVTb3J0aW5nO1xyXG59O1xyXG5HcmlkT3B0aW9uc1dyYXBwZXIucHJvdG90eXBlLmlzRW5hYmxlQ29sUmVzaXplID0gZnVuY3Rpb24oKSB7XHJcbiAgICByZXR1cm4gdGhpcy5ncmlkT3B0aW9ucy5lbmFibGVDb2xSZXNpemU7XHJcbn07XHJcbkdyaWRPcHRpb25zV3JhcHBlci5wcm90b3R5cGUuaXNFbmFibGVGaWx0ZXIgPSBmdW5jdGlvbigpIHtcclxuICAgIHJldHVybiB0aGlzLmdyaWRPcHRpb25zLmVuYWJsZUZpbHRlcjtcclxufTtcclxuR3JpZE9wdGlvbnNXcmFwcGVyLnByb3RvdHlwZS5nZXRHcm91cERlZmF1bHRFeHBhbmRlZCA9IGZ1bmN0aW9uKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuZ3JpZE9wdGlvbnMuZ3JvdXBEZWZhdWx0RXhwYW5kZWQ7XHJcbn07XHJcbkdyaWRPcHRpb25zV3JhcHBlci5wcm90b3R5cGUuZ2V0R3JvdXBLZXlzID0gZnVuY3Rpb24oKSB7XHJcbiAgICByZXR1cm4gdGhpcy5ncmlkT3B0aW9ucy5ncm91cEtleXM7XHJcbn07XHJcbkdyaWRPcHRpb25zV3JhcHBlci5wcm90b3R5cGUuZ2V0R3JvdXBJY29uUmVuZGVyZXIgPSBmdW5jdGlvbigpIHtcclxuICAgIHJldHVybiB0aGlzLmdyaWRPcHRpb25zLmdyb3VwSWNvblJlbmRlcmVyO1xyXG59O1xyXG5HcmlkT3B0aW9uc1dyYXBwZXIucHJvdG90eXBlLmdldEdyb3VwQWdnRnVuY3Rpb24gPSBmdW5jdGlvbigpIHtcclxuICAgIHJldHVybiB0aGlzLmdyaWRPcHRpb25zLmdyb3VwQWdnRnVuY3Rpb247XHJcbn07XHJcbkdyaWRPcHRpb25zV3JhcHBlci5wcm90b3R5cGUuZ2V0QWxsUm93cyA9IGZ1bmN0aW9uKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuZ3JpZE9wdGlvbnMucm93RGF0YTtcclxufTtcclxuR3JpZE9wdGlvbnNXcmFwcGVyLnByb3RvdHlwZS5pc0dyb3VwVXNlRW50aXJlUm93ID0gZnVuY3Rpb24oKSB7XHJcbiAgICByZXR1cm4gaXNUcnVlKHRoaXMuZ3JpZE9wdGlvbnMuZ3JvdXBVc2VFbnRpcmVSb3cpO1xyXG59O1xyXG5HcmlkT3B0aW9uc1dyYXBwZXIucHJvdG90eXBlLmlzQW5ndWxhckNvbXBpbGVSb3dzID0gZnVuY3Rpb24oKSB7XHJcbiAgICByZXR1cm4gaXNUcnVlKHRoaXMuZ3JpZE9wdGlvbnMuYW5ndWxhckNvbXBpbGVSb3dzKTtcclxufTtcclxuR3JpZE9wdGlvbnNXcmFwcGVyLnByb3RvdHlwZS5pc0FuZ3VsYXJDb21waWxlRmlsdGVycyA9IGZ1bmN0aW9uKCkge1xyXG4gICAgcmV0dXJuIGlzVHJ1ZSh0aGlzLmdyaWRPcHRpb25zLmFuZ3VsYXJDb21waWxlRmlsdGVycyk7XHJcbn07XHJcbkdyaWRPcHRpb25zV3JhcHBlci5wcm90b3R5cGUuaXNBbmd1bGFyQ29tcGlsZUhlYWRlcnMgPSBmdW5jdGlvbigpIHtcclxuICAgIHJldHVybiBpc1RydWUodGhpcy5ncmlkT3B0aW9ucy5hbmd1bGFyQ29tcGlsZUhlYWRlcnMpO1xyXG59O1xyXG5HcmlkT3B0aW9uc1dyYXBwZXIucHJvdG90eXBlLmdldENvbHVtbkRlZnMgPSBmdW5jdGlvbigpIHtcclxuICAgIHJldHVybiB0aGlzLmdyaWRPcHRpb25zLmNvbHVtbkRlZnM7XHJcbn07XHJcbkdyaWRPcHRpb25zV3JhcHBlci5wcm90b3R5cGUuZ2V0Um93SGVpZ2h0ID0gZnVuY3Rpb24oKSB7XHJcbiAgICByZXR1cm4gdGhpcy5ncmlkT3B0aW9ucy5yb3dIZWlnaHQ7XHJcbn07XHJcbkdyaWRPcHRpb25zV3JhcHBlci5wcm90b3R5cGUuZ2V0TW9kZWxVcGRhdGVkID0gZnVuY3Rpb24oKSB7XHJcbiAgICByZXR1cm4gdGhpcy5ncmlkT3B0aW9ucy5tb2RlbFVwZGF0ZWQ7XHJcbn07XHJcbkdyaWRPcHRpb25zV3JhcHBlci5wcm90b3R5cGUuZ2V0Q2VsbENsaWNrZWQgPSBmdW5jdGlvbigpIHtcclxuICAgIHJldHVybiB0aGlzLmdyaWRPcHRpb25zLmNlbGxDbGlja2VkO1xyXG59O1xyXG5HcmlkT3B0aW9uc1dyYXBwZXIucHJvdG90eXBlLmdldENlbGxEb3VibGVDbGlja2VkID0gZnVuY3Rpb24oKSB7XHJcbiAgICByZXR1cm4gdGhpcy5ncmlkT3B0aW9ucy5jZWxsRG91YmxlQ2xpY2tlZDtcclxufTtcclxuR3JpZE9wdGlvbnNXcmFwcGVyLnByb3RvdHlwZS5nZXRSb3dTZWxlY3RlZCA9IGZ1bmN0aW9uKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuZ3JpZE9wdGlvbnMucm93U2VsZWN0ZWQ7XHJcbn07XHJcbkdyaWRPcHRpb25zV3JhcHBlci5wcm90b3R5cGUuZ2V0U2VsZWN0aW9uQ2hhbmdlZCA9IGZ1bmN0aW9uKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuZ3JpZE9wdGlvbnMuc2VsZWN0aW9uQ2hhbmdlZDtcclxufTtcclxuR3JpZE9wdGlvbnNXcmFwcGVyLnByb3RvdHlwZS5nZXRWaXJ0dWFsUm93UmVtb3ZlZCA9IGZ1bmN0aW9uKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuZ3JpZE9wdGlvbnMudmlydHVhbFJvd1JlbW92ZWQ7XHJcbn07XHJcbkdyaWRPcHRpb25zV3JhcHBlci5wcm90b3R5cGUuZ2V0RGF0YXNvdXJjZSA9IGZ1bmN0aW9uKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuZ3JpZE9wdGlvbnMuZGF0YXNvdXJjZTtcclxufTtcclxuXHJcbkdyaWRPcHRpb25zV3JhcHBlci5wcm90b3R5cGUuc2V0U2VsZWN0ZWRSb3dzID0gZnVuY3Rpb24obmV3U2VsZWN0ZWRSb3dzKSB7XHJcbiAgICByZXR1cm4gdGhpcy5ncmlkT3B0aW9ucy5zZWxlY3RlZFJvd3MgPSBuZXdTZWxlY3RlZFJvd3M7XHJcbn07XHJcbkdyaWRPcHRpb25zV3JhcHBlci5wcm90b3R5cGUuc2V0U2VsZWN0ZWROb2Rlc0J5SWQgPSBmdW5jdGlvbihuZXdTZWxlY3RlZE5vZGVzKSB7XHJcbiAgICByZXR1cm4gdGhpcy5ncmlkT3B0aW9ucy5zZWxlY3RlZE5vZGVzQnlJZCA9IG5ld1NlbGVjdGVkTm9kZXM7XHJcbn07XHJcblxyXG5HcmlkT3B0aW9uc1dyYXBwZXIucHJvdG90eXBlLmdldEljb25zID0gZnVuY3Rpb24oKSB7XHJcbiAgICByZXR1cm4gdGhpcy5ncmlkT3B0aW9ucy5pY29ucztcclxufTtcclxuXHJcbkdyaWRPcHRpb25zV3JhcHBlci5wcm90b3R5cGUuaXNEb0ludGVybmFsR3JvdXBpbmcgPSBmdW5jdGlvbigpIHtcclxuICAgIHJldHVybiAhdGhpcy5pc1Jvd3NBbHJlYWR5R3JvdXBlZCgpICYmIHRoaXMuZ3JpZE9wdGlvbnMuZ3JvdXBLZXlzO1xyXG59O1xyXG5cclxuR3JpZE9wdGlvbnNXcmFwcGVyLnByb3RvdHlwZS5pc0dyb3VwQ2hlY2tib3hTZWxlY3Rpb24gPSBmdW5jdGlvbigpIHtcclxuICAgIHJldHVybiB0aGlzLmlzR3JvdXBDaGVja2JveFNlbGVjdGlvbkNoaWxkcmVuKCkgfHwgdGhpcy5pc0dyb3VwQ2hlY2tib3hTZWxlY3Rpb25Hcm91cCgpO1xyXG59O1xyXG5cclxuR3JpZE9wdGlvbnNXcmFwcGVyLnByb3RvdHlwZS5nZXRIZWFkZXJIZWlnaHQgPSBmdW5jdGlvbigpIHtcclxuICAgIGlmICh0eXBlb2YgdGhpcy5ncmlkT3B0aW9ucy5oZWFkZXJIZWlnaHQgPT09ICdudW1iZXInKSB7XHJcbiAgICAgICAgLy8gaWYgaGVhZGVyIGhlaWdodCBwcm92aWRlZCwgdXNlZCBpdFxyXG4gICAgICAgIHJldHVybiB0aGlzLmdyaWRPcHRpb25zLmhlYWRlckhlaWdodDtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgLy8gb3RoZXJ3aXNlIHJldHVybiAyNSBpZiBubyBncm91cGluZywgNTAgaWYgZ3JvdXBpbmdcclxuICAgICAgICBpZiAodGhpcy5pc0dyb3VwSGVhZGVycygpKSB7XHJcbiAgICAgICAgICAgIHJldHVybiA1MDtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICByZXR1cm4gMjU7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG59O1xyXG5cclxuR3JpZE9wdGlvbnNXcmFwcGVyLnByb3RvdHlwZS5pc0NvbHVtRGVmc1ByZXNlbnQgPSBmdW5jdGlvbigpIHtcclxuICAgIHJldHVybiB0aGlzLmdyaWRPcHRpb25zLmNvbHVtbkRlZnMgJiYgdGhpcy5ncmlkT3B0aW9ucy5jb2x1bW5EZWZzLmxlbmd0aCAhPSAwO1xyXG59O1xyXG5cclxuR3JpZE9wdGlvbnNXcmFwcGVyLnByb3RvdHlwZS5zZXR1cERlZmF1bHRzID0gZnVuY3Rpb24oKSB7XHJcbiAgICBpZiAoIXRoaXMuZ3JpZE9wdGlvbnMucm93SGVpZ2h0KSB7XHJcbiAgICAgICAgdGhpcy5ncmlkT3B0aW9ucy5yb3dIZWlnaHQgPSBERUZBVUxUX1JPV19IRUlHSFQ7XHJcbiAgICB9XHJcbn07XHJcblxyXG5HcmlkT3B0aW9uc1dyYXBwZXIucHJvdG90eXBlLmdldFBpbm5lZENvbENvdW50ID0gZnVuY3Rpb24oKSB7XHJcbiAgICAvLyBpZiBub3QgdXNpbmcgc2Nyb2xscywgdGhlbiBwaW5uZWQgY29sdW1ucyBkb2Vzbid0IG1ha2VcclxuICAgIC8vIHNlbnNlLCBzbyBhbHdheXMgcmV0dXJuIDBcclxuICAgIGlmICh0aGlzLmlzRG9udFVzZVNjcm9sbHMoKSkge1xyXG4gICAgICAgIHJldHVybiAwO1xyXG4gICAgfVxyXG4gICAgaWYgKHRoaXMuZ3JpZE9wdGlvbnMucGlubmVkQ29sdW1uQ291bnQpIHtcclxuICAgICAgICAvL2luIGNhc2UgdXNlciBwdXRzIGluIGEgc3RyaW5nLCBjYXN0IHRvIG51bWJlclxyXG4gICAgICAgIHJldHVybiBOdW1iZXIodGhpcy5ncmlkT3B0aW9ucy5waW5uZWRDb2x1bW5Db3VudCk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHJldHVybiAwO1xyXG4gICAgfVxyXG59O1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBHcmlkT3B0aW9uc1dyYXBwZXI7XHJcbiIsImZ1bmN0aW9uIEdyb3VwQ3JlYXRvcigpIHt9XHJcblxyXG5Hcm91cENyZWF0b3IucHJvdG90eXBlLmdyb3VwID0gZnVuY3Rpb24ocm93Tm9kZXMsIGdyb3VwQnlGaWVsZHMsIGdyb3VwQWdnRnVuY3Rpb24sIGV4cGFuZEJ5RGVmYXVsdCkge1xyXG5cclxuICAgIHZhciB0b3BNb3N0R3JvdXAgPSB7XHJcbiAgICAgICAgbGV2ZWw6IC0xLFxyXG4gICAgICAgIGNoaWxkcmVuOiBbXSxcclxuICAgICAgICBjaGlsZHJlbk1hcDoge31cclxuICAgIH07XHJcblxyXG4gICAgdmFyIGFsbEdyb3VwcyA9IFtdO1xyXG4gICAgYWxsR3JvdXBzLnB1c2godG9wTW9zdEdyb3VwKTtcclxuXHJcbiAgICB2YXIgbGV2ZWxUb0luc2VydENoaWxkID0gZ3JvdXBCeUZpZWxkcy5sZW5ndGggLSAxO1xyXG4gICAgdmFyIGksIGN1cnJlbnRMZXZlbCwgbm9kZSwgZGF0YSwgY3VycmVudEdyb3VwLCBncm91cEJ5RmllbGQsIGdyb3VwS2V5LCBuZXh0R3JvdXA7XHJcblxyXG4gICAgLy8gc3RhcnQgYXQgLTEgYW5kIGdvIGJhY2t3YXJkcywgYXMgYWxsIHRoZSBwb3NpdGl2ZSBpbmRleGVzXHJcbiAgICAvLyBhcmUgYWxyZWFkeSB1c2VkIGJ5IHRoZSBub2Rlcy5cclxuICAgIHZhciBpbmRleCA9IC0xO1xyXG5cclxuICAgIGZvciAoaSA9IDA7IGkgPCByb3dOb2Rlcy5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgIG5vZGUgPSByb3dOb2Rlc1tpXTtcclxuICAgICAgICBkYXRhID0gbm9kZS5kYXRhO1xyXG5cclxuICAgICAgICBmb3IgKGN1cnJlbnRMZXZlbCA9IDA7IGN1cnJlbnRMZXZlbCA8IGdyb3VwQnlGaWVsZHMubGVuZ3RoOyBjdXJyZW50TGV2ZWwrKykge1xyXG4gICAgICAgICAgICBncm91cEJ5RmllbGQgPSBncm91cEJ5RmllbGRzW2N1cnJlbnRMZXZlbF07XHJcbiAgICAgICAgICAgIGdyb3VwS2V5ID0gZGF0YVtncm91cEJ5RmllbGRdO1xyXG5cclxuICAgICAgICAgICAgaWYgKGN1cnJlbnRMZXZlbCA9PSAwKSB7XHJcbiAgICAgICAgICAgICAgICBjdXJyZW50R3JvdXAgPSB0b3BNb3N0R3JvdXA7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIC8vaWYgZ3JvdXAgZG9lc24ndCBleGlzdCB5ZXQsIGNyZWF0ZSBpdFxyXG4gICAgICAgICAgICBuZXh0R3JvdXAgPSBjdXJyZW50R3JvdXAuY2hpbGRyZW5NYXBbZ3JvdXBLZXldO1xyXG4gICAgICAgICAgICBpZiAoIW5leHRHcm91cCkge1xyXG4gICAgICAgICAgICAgICAgbmV4dEdyb3VwID0ge1xyXG4gICAgICAgICAgICAgICAgICAgIGdyb3VwOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgIGZpZWxkOiBncm91cEJ5RmllbGQsXHJcbiAgICAgICAgICAgICAgICAgICAgaWQ6IGluZGV4LS0sXHJcbiAgICAgICAgICAgICAgICAgICAga2V5OiBncm91cEtleSxcclxuICAgICAgICAgICAgICAgICAgICBleHBhbmRlZDogdGhpcy5pc0V4cGFuZGVkKGV4cGFuZEJ5RGVmYXVsdCwgY3VycmVudExldmVsKSxcclxuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlbjogW10sXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gZm9yIHRvcCBtb3N0IGxldmVsLCBwYXJlbnQgaXMgbnVsbFxyXG4gICAgICAgICAgICAgICAgICAgIHBhcmVudDogY3VycmVudEdyb3VwID09PSB0b3BNb3N0R3JvdXAgPyBudWxsIDogY3VycmVudEdyb3VwLFxyXG4gICAgICAgICAgICAgICAgICAgIGFsbENoaWxkcmVuQ291bnQ6IDAsXHJcbiAgICAgICAgICAgICAgICAgICAgbGV2ZWw6IGN1cnJlbnRHcm91cC5sZXZlbCArIDEsXHJcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRyZW5NYXA6IHt9IC8vdGhpcyBpcyBhIHRlbXBvcmFyeSBtYXAsIHdlIHJlbW92ZSBhdCB0aGUgZW5kIG9mIHRoaXMgbWV0aG9kXHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgY3VycmVudEdyb3VwLmNoaWxkcmVuTWFwW2dyb3VwS2V5XSA9IG5leHRHcm91cDtcclxuICAgICAgICAgICAgICAgIGN1cnJlbnRHcm91cC5jaGlsZHJlbi5wdXNoKG5leHRHcm91cCk7XHJcbiAgICAgICAgICAgICAgICBhbGxHcm91cHMucHVzaChuZXh0R3JvdXApO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBuZXh0R3JvdXAuYWxsQ2hpbGRyZW5Db3VudCsrO1xyXG5cclxuICAgICAgICAgICAgaWYgKGN1cnJlbnRMZXZlbCA9PSBsZXZlbFRvSW5zZXJ0Q2hpbGQpIHtcclxuICAgICAgICAgICAgICAgIG5vZGUucGFyZW50ID0gbmV4dEdyb3VwID09PSB0b3BNb3N0R3JvdXAgPyBudWxsIDogbmV4dEdyb3VwO1xyXG4gICAgICAgICAgICAgICAgbmV4dEdyb3VwLmNoaWxkcmVuLnB1c2gobm9kZSk7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBjdXJyZW50R3JvdXAgPSBuZXh0R3JvdXA7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgfVxyXG5cclxuICAgIC8vcmVtb3ZlIHRoZSB0ZW1wb3JhcnkgbWFwXHJcbiAgICBmb3IgKGkgPSAwOyBpIDwgYWxsR3JvdXBzLmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgZGVsZXRlIGFsbEdyb3Vwc1tpXS5jaGlsZHJlbk1hcDtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gdG9wTW9zdEdyb3VwLmNoaWxkcmVuO1xyXG59O1xyXG5cclxuR3JvdXBDcmVhdG9yLnByb3RvdHlwZS5pc0V4cGFuZGVkID0gZnVuY3Rpb24oZXhwYW5kQnlEZWZhdWx0LCBsZXZlbCkge1xyXG4gICAgaWYgKHR5cGVvZiBleHBhbmRCeURlZmF1bHQgPT09ICdudW1iZXInKSB7XHJcbiAgICAgICAgcmV0dXJuIGxldmVsIDwgZXhwYW5kQnlEZWZhdWx0O1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICByZXR1cm4gZXhwYW5kQnlEZWZhdWx0ID09PSB0cnVlIHx8IGV4cGFuZEJ5RGVmYXVsdCA9PT0gJ3RydWUnO1xyXG4gICAgfVxyXG59O1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBuZXcgR3JvdXBDcmVhdG9yKCk7XHJcbiIsInZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMnKTtcclxudmFyIFN2Z0ZhY3RvcnkgPSByZXF1aXJlKCcuL3N2Z0ZhY3RvcnknKTtcclxudmFyIGNvbnN0YW50cyA9IHJlcXVpcmUoJy4vY29uc3RhbnRzJyk7XHJcblxyXG52YXIgc3ZnRmFjdG9yeSA9IG5ldyBTdmdGYWN0b3J5KCk7XHJcblxyXG5mdW5jdGlvbiBIZWFkZXJSZW5kZXJlcigpIHt9XHJcblxyXG5IZWFkZXJSZW5kZXJlci5wcm90b3R5cGUuaW5pdCA9IGZ1bmN0aW9uKGdyaWRPcHRpb25zV3JhcHBlciwgY29sdW1uQ29udHJvbGxlciwgY29sdW1uTW9kZWwsIGVHcmlkLCBhbmd1bGFyR3JpZCwgZmlsdGVyTWFuYWdlciwgJHNjb3BlLCAkY29tcGlsZSkge1xyXG4gICAgdGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIgPSBncmlkT3B0aW9uc1dyYXBwZXI7XHJcbiAgICB0aGlzLmNvbHVtbk1vZGVsID0gY29sdW1uTW9kZWw7XHJcbiAgICB0aGlzLmNvbHVtbkNvbnRyb2xsZXIgPSBjb2x1bW5Db250cm9sbGVyO1xyXG4gICAgdGhpcy5hbmd1bGFyR3JpZCA9IGFuZ3VsYXJHcmlkO1xyXG4gICAgdGhpcy5maWx0ZXJNYW5hZ2VyID0gZmlsdGVyTWFuYWdlcjtcclxuICAgIHRoaXMuJHNjb3BlID0gJHNjb3BlO1xyXG4gICAgdGhpcy4kY29tcGlsZSA9ICRjb21waWxlO1xyXG4gICAgdGhpcy5maW5kQWxsRWxlbWVudHMoZUdyaWQpO1xyXG59O1xyXG5cclxuSGVhZGVyUmVuZGVyZXIucHJvdG90eXBlLmZpbmRBbGxFbGVtZW50cyA9IGZ1bmN0aW9uKGVHcmlkKSB7XHJcblxyXG4gICAgaWYgKHRoaXMuZ3JpZE9wdGlvbnNXcmFwcGVyLmlzRG9udFVzZVNjcm9sbHMoKSkge1xyXG4gICAgICAgIHRoaXMuZUhlYWRlckNvbnRhaW5lciA9IGVHcmlkLnF1ZXJ5U2VsZWN0b3IoXCIuYWctaGVhZGVyLWNvbnRhaW5lclwiKTtcclxuICAgICAgICB0aGlzLmVSb290ID0gZUdyaWQucXVlcnlTZWxlY3RvcihcIi5hZy1yb290XCIpO1xyXG4gICAgICAgIC8vIGZvciBuby1zY3JvbGwsIGFsbCBoZWFkZXIgY2VsbHMgbGl2ZSBpbiB0aGUgaGVhZGVyIGNvbnRhaW5lciAodGhlIGFnLWhlYWRlciBkb2Vzbid0IGV4aXN0KVxyXG4gICAgICAgIHRoaXMuZUhlYWRlclBhcmVudCA9IHRoaXMuZUhlYWRlckNvbnRhaW5lcjtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdGhpcy5lUGlubmVkSGVhZGVyID0gZUdyaWQucXVlcnlTZWxlY3RvcihcIi5hZy1waW5uZWQtaGVhZGVyXCIpO1xyXG4gICAgICAgIHRoaXMuZUhlYWRlckNvbnRhaW5lciA9IGVHcmlkLnF1ZXJ5U2VsZWN0b3IoXCIuYWctaGVhZGVyLWNvbnRhaW5lclwiKTtcclxuICAgICAgICB0aGlzLmVIZWFkZXIgPSBlR3JpZC5xdWVyeVNlbGVjdG9yKFwiLmFnLWhlYWRlclwiKTtcclxuICAgICAgICB0aGlzLmVSb290ID0gZUdyaWQucXVlcnlTZWxlY3RvcihcIi5hZy1yb290XCIpO1xyXG4gICAgICAgIC8vIGZvciBzY3JvbGwsIGFsbCBoZWFkZXIgY2VsbHMgbGl2ZSBpbiB0aGUgaGVhZGVyIChjb250YWlucyBib3RoIG5vcm1hbCBhbmQgcGlubmVkIGhlYWRlcnMpXHJcbiAgICAgICAgdGhpcy5lSGVhZGVyUGFyZW50ID0gdGhpcy5lSGVhZGVyO1xyXG4gICAgfVxyXG59O1xyXG5cclxuSGVhZGVyUmVuZGVyZXIucHJvdG90eXBlLnJlZnJlc2hIZWFkZXIgPSBmdW5jdGlvbigpIHtcclxuICAgIHV0aWxzLnJlbW92ZUFsbENoaWxkcmVuKHRoaXMuZVBpbm5lZEhlYWRlcik7XHJcbiAgICB1dGlscy5yZW1vdmVBbGxDaGlsZHJlbih0aGlzLmVIZWFkZXJDb250YWluZXIpO1xyXG5cclxuICAgIGlmICh0aGlzLmNoaWxkU2NvcGVzKSB7XHJcbiAgICAgICAgdGhpcy5jaGlsZFNjb3Blcy5mb3JFYWNoKGZ1bmN0aW9uKGNoaWxkU2NvcGUpIHtcclxuICAgICAgICAgICAgY2hpbGRTY29wZS4kZGVzdHJveSgpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgdGhpcy5jaGlsZFNjb3BlcyA9IFtdO1xyXG5cclxuICAgIGlmICh0aGlzLmdyaWRPcHRpb25zV3JhcHBlci5pc0dyb3VwSGVhZGVycygpKSB7XHJcbiAgICAgICAgdGhpcy5pbnNlcnRIZWFkZXJzV2l0aEdyb3VwaW5nKCk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHRoaXMuaW5zZXJ0SGVhZGVyc1dpdGhvdXRHcm91cGluZygpO1xyXG4gICAgfVxyXG5cclxufTtcclxuXHJcbkhlYWRlclJlbmRlcmVyLnByb3RvdHlwZS5pbnNlcnRIZWFkZXJzV2l0aEdyb3VwaW5nID0gZnVuY3Rpb24oKSB7XHJcbiAgICB2YXIgZ3JvdXBzID0gdGhpcy5jb2x1bW5Nb2RlbC5nZXRDb2x1bW5Hcm91cHMoKTtcclxuICAgIHZhciB0aGF0ID0gdGhpcztcclxuICAgIGdyb3Vwcy5mb3JFYWNoKGZ1bmN0aW9uKGdyb3VwKSB7XHJcbiAgICAgICAgdmFyIGVIZWFkZXJDZWxsID0gdGhhdC5jcmVhdGVHcm91cGVkSGVhZGVyQ2VsbChncm91cCk7XHJcbiAgICAgICAgdmFyIGVDb250YWluZXJUb0FkZFRvID0gZ3JvdXAucGlubmVkID8gdGhhdC5lUGlubmVkSGVhZGVyIDogdGhhdC5lSGVhZGVyQ29udGFpbmVyO1xyXG4gICAgICAgIGVDb250YWluZXJUb0FkZFRvLmFwcGVuZENoaWxkKGVIZWFkZXJDZWxsKTtcclxuICAgIH0pO1xyXG59O1xyXG5cclxuSGVhZGVyUmVuZGVyZXIucHJvdG90eXBlLmNyZWF0ZUdyb3VwZWRIZWFkZXJDZWxsID0gZnVuY3Rpb24oZ3JvdXApIHtcclxuXHJcbiAgICB2YXIgZUhlYWRlckdyb3VwID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XHJcbiAgICBlSGVhZGVyR3JvdXAuY2xhc3NOYW1lID0gJ2FnLWhlYWRlci1ncm91cCc7XHJcblxyXG4gICAgdmFyIGVIZWFkZXJHcm91cENlbGwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcclxuICAgIGdyb3VwLmVIZWFkZXJHcm91cENlbGwgPSBlSGVhZGVyR3JvdXBDZWxsO1xyXG4gICAgdmFyIGNsYXNzTmFtZXMgPSBbJ2FnLWhlYWRlci1ncm91cC1jZWxsJ107XHJcbiAgICAvLyBoYXZpbmcgZGlmZmVyZW50IGNsYXNzZXMgYmVsb3cgYWxsb3dzIHRoZSBzdHlsZSB0byBub3QgaGF2ZSBhIGJvdHRvbSBib3JkZXJcclxuICAgIC8vIG9uIHRoZSBncm91cCBoZWFkZXIsIGlmIG5vIGdyb3VwIGlzIHNwZWNpZmllZFxyXG4gICAgaWYgKGdyb3VwLm5hbWUpIHtcclxuICAgICAgICBjbGFzc05hbWVzLnB1c2goJ2FnLWhlYWRlci1ncm91cC1jZWxsLXdpdGgtZ3JvdXAnKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgY2xhc3NOYW1lcy5wdXNoKCdhZy1oZWFkZXItZ3JvdXAtY2VsbC1uby1ncm91cCcpO1xyXG4gICAgfVxyXG4gICAgZUhlYWRlckdyb3VwQ2VsbC5jbGFzc05hbWUgPSBjbGFzc05hbWVzLmpvaW4oJyAnKTtcclxuXHJcbiAgICBpZiAodGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuaXNFbmFibGVDb2xSZXNpemUoKSkge1xyXG4gICAgICAgIHZhciBlSGVhZGVyQ2VsbFJlc2l6ZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICAgICAgZUhlYWRlckNlbGxSZXNpemUuY2xhc3NOYW1lID0gXCJhZy1oZWFkZXItY2VsbC1yZXNpemVcIjtcclxuICAgICAgICBlSGVhZGVyR3JvdXBDZWxsLmFwcGVuZENoaWxkKGVIZWFkZXJDZWxsUmVzaXplKTtcclxuICAgICAgICBncm91cC5lSGVhZGVyQ2VsbFJlc2l6ZSA9IGVIZWFkZXJDZWxsUmVzaXplO1xyXG4gICAgICAgIHZhciBkcmFnQ2FsbGJhY2sgPSB0aGlzLmdyb3VwRHJhZ0NhbGxiYWNrRmFjdG9yeShncm91cCk7XHJcbiAgICAgICAgdGhpcy5hZGREcmFnSGFuZGxlcihlSGVhZGVyQ2VsbFJlc2l6ZSwgZHJhZ0NhbGxiYWNrKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBubyByZW5kZXJlciwgZGVmYXVsdCB0ZXh0IHJlbmRlclxyXG4gICAgdmFyIGdyb3VwTmFtZSA9IGdyb3VwLm5hbWU7XHJcbiAgICBpZiAoZ3JvdXBOYW1lICYmIGdyb3VwTmFtZSAhPT0gJycpIHtcclxuICAgICAgICB2YXIgZUdyb3VwQ2VsbExhYmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcclxuICAgICAgICBlR3JvdXBDZWxsTGFiZWwuY2xhc3NOYW1lID0gJ2FnLWhlYWRlci1ncm91cC1jZWxsLWxhYmVsJztcclxuICAgICAgICBlSGVhZGVyR3JvdXBDZWxsLmFwcGVuZENoaWxkKGVHcm91cENlbGxMYWJlbCk7XHJcblxyXG4gICAgICAgIHZhciBlSW5uZXJUZXh0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgZUlubmVyVGV4dC5jbGFzc05hbWUgPSAnYWctaGVhZGVyLWdyb3VwLXRleHQnO1xyXG4gICAgICAgIGVJbm5lclRleHQuaW5uZXJIVE1MID0gZ3JvdXBOYW1lO1xyXG4gICAgICAgIGVHcm91cENlbGxMYWJlbC5hcHBlbmRDaGlsZChlSW5uZXJUZXh0KTtcclxuXHJcbiAgICAgICAgaWYgKGdyb3VwLmV4cGFuZGFibGUpIHtcclxuICAgICAgICAgICAgdGhpcy5hZGRHcm91cEV4cGFuZEljb24oZ3JvdXAsIGVHcm91cENlbGxMYWJlbCwgZ3JvdXAuZXhwYW5kZWQpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIGVIZWFkZXJHcm91cC5hcHBlbmRDaGlsZChlSGVhZGVyR3JvdXBDZWxsKTtcclxuXHJcbiAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICBncm91cC52aXNpYmxlQ29sdW1ucy5mb3JFYWNoKGZ1bmN0aW9uKGNvbHVtbikge1xyXG4gICAgICAgIHZhciBlSGVhZGVyQ2VsbCA9IHRoYXQuY3JlYXRlSGVhZGVyQ2VsbChjb2x1bW4sIHRydWUsIGdyb3VwKTtcclxuICAgICAgICBlSGVhZGVyR3JvdXAuYXBwZW5kQ2hpbGQoZUhlYWRlckNlbGwpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgdGhhdC5zZXRXaWR0aE9mR3JvdXBIZWFkZXJDZWxsKGdyb3VwKTtcclxuXHJcbiAgICByZXR1cm4gZUhlYWRlckdyb3VwO1xyXG59O1xyXG5cclxuSGVhZGVyUmVuZGVyZXIucHJvdG90eXBlLmFkZEdyb3VwRXhwYW5kSWNvbiA9IGZ1bmN0aW9uKGdyb3VwLCBlSGVhZGVyR3JvdXAsIGV4cGFuZGVkKSB7XHJcbiAgICB2YXIgZUdyb3VwSWNvbjtcclxuICAgIGlmIChleHBhbmRlZCkge1xyXG4gICAgICAgIGVHcm91cEljb24gPSB1dGlscy5jcmVhdGVJY29uKCdjb2x1bW5Hcm91cE9wZW5lZCcsIHRoaXMuZ3JpZE9wdGlvbnNXcmFwcGVyLCBudWxsLCBzdmdGYWN0b3J5LmNyZWF0ZUFycm93TGVmdFN2Zyk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIGVHcm91cEljb24gPSB1dGlscy5jcmVhdGVJY29uKCdjb2x1bW5Hcm91cENsb3NlZCcsIHRoaXMuZ3JpZE9wdGlvbnNXcmFwcGVyLCBudWxsLCBzdmdGYWN0b3J5LmNyZWF0ZUFycm93UmlnaHRTdmcpO1xyXG4gICAgfVxyXG4gICAgZUdyb3VwSWNvbi5jbGFzc05hbWUgPSAnYWctaGVhZGVyLWV4cGFuZC1pY29uJztcclxuICAgIGVIZWFkZXJHcm91cC5hcHBlbmRDaGlsZChlR3JvdXBJY29uKTtcclxuXHJcbiAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICBlR3JvdXBJY29uLm9uY2xpY2sgPSBmdW5jdGlvbigpIHtcclxuICAgICAgICB0aGF0LmNvbHVtbkNvbnRyb2xsZXIuY29sdW1uR3JvdXBPcGVuZWQoZ3JvdXApO1xyXG4gICAgfTtcclxufTtcclxuXHJcbkhlYWRlclJlbmRlcmVyLnByb3RvdHlwZS5hZGREcmFnSGFuZGxlciA9IGZ1bmN0aW9uKGVEcmFnZ2FibGVFbGVtZW50LCBkcmFnQ2FsbGJhY2spIHtcclxuICAgIHZhciB0aGF0ID0gdGhpcztcclxuICAgIGVEcmFnZ2FibGVFbGVtZW50Lm9ubW91c2Vkb3duID0gZnVuY3Rpb24oZG93bkV2ZW50KSB7XHJcbiAgICAgICAgZHJhZ0NhbGxiYWNrLm9uRHJhZ1N0YXJ0KCk7XHJcbiAgICAgICAgdGhhdC5lUm9vdC5zdHlsZS5jdXJzb3IgPSBcImNvbC1yZXNpemVcIjtcclxuICAgICAgICB0aGF0LmRyYWdTdGFydFggPSBkb3duRXZlbnQuY2xpZW50WDtcclxuXHJcbiAgICAgICAgdGhhdC5lUm9vdC5vbm1vdXNlbW92ZSA9IGZ1bmN0aW9uKG1vdmVFdmVudCkge1xyXG4gICAgICAgICAgICB2YXIgbmV3WCA9IG1vdmVFdmVudC5jbGllbnRYO1xyXG4gICAgICAgICAgICB2YXIgY2hhbmdlID0gbmV3WCAtIHRoYXQuZHJhZ1N0YXJ0WDtcclxuICAgICAgICAgICAgZHJhZ0NhbGxiYWNrLm9uRHJhZ2dpbmcoY2hhbmdlKTtcclxuICAgICAgICB9O1xyXG4gICAgICAgIHRoYXQuZVJvb3Qub25tb3VzZXVwID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHRoYXQuc3RvcERyYWdnaW5nKCk7XHJcbiAgICAgICAgfTtcclxuICAgICAgICB0aGF0LmVSb290Lm9ubW91c2VsZWF2ZSA9IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICB0aGF0LnN0b3BEcmFnZ2luZygpO1xyXG4gICAgICAgIH07XHJcbiAgICB9O1xyXG59O1xyXG5cclxuSGVhZGVyUmVuZGVyZXIucHJvdG90eXBlLnNldFdpZHRoT2ZHcm91cEhlYWRlckNlbGwgPSBmdW5jdGlvbihoZWFkZXJHcm91cCkge1xyXG4gICAgdmFyIHRvdGFsV2lkdGggPSAwO1xyXG4gICAgaGVhZGVyR3JvdXAudmlzaWJsZUNvbHVtbnMuZm9yRWFjaChmdW5jdGlvbihjb2x1bW4pIHtcclxuICAgICAgICB0b3RhbFdpZHRoICs9IGNvbHVtbi5hY3R1YWxXaWR0aDtcclxuICAgIH0pO1xyXG4gICAgaGVhZGVyR3JvdXAuZUhlYWRlckdyb3VwQ2VsbC5zdHlsZS53aWR0aCA9IHV0aWxzLmZvcm1hdFdpZHRoKHRvdGFsV2lkdGgpO1xyXG4gICAgaGVhZGVyR3JvdXAuYWN0dWFsV2lkdGggPSB0b3RhbFdpZHRoO1xyXG59O1xyXG5cclxuSGVhZGVyUmVuZGVyZXIucHJvdG90eXBlLmluc2VydEhlYWRlcnNXaXRob3V0R3JvdXBpbmcgPSBmdW5jdGlvbigpIHtcclxuICAgIHZhciBlUGlubmVkSGVhZGVyID0gdGhpcy5lUGlubmVkSGVhZGVyO1xyXG4gICAgdmFyIGVIZWFkZXJDb250YWluZXIgPSB0aGlzLmVIZWFkZXJDb250YWluZXI7XHJcbiAgICB2YXIgdGhhdCA9IHRoaXM7XHJcblxyXG4gICAgdGhpcy5jb2x1bW5Nb2RlbC5nZXRWaXNpYmxlQ29sdW1ucygpLmZvckVhY2goZnVuY3Rpb24oY29sdW1uKSB7XHJcbiAgICAgICAgLy8gb25seSBpbmNsdWRlIHRoZSBmaXJzdCB4IGNvbHNcclxuICAgICAgICB2YXIgaGVhZGVyQ2VsbCA9IHRoYXQuY3JlYXRlSGVhZGVyQ2VsbChjb2x1bW4sIGZhbHNlKTtcclxuICAgICAgICBpZiAoY29sdW1uLnBpbm5lZCkge1xyXG4gICAgICAgICAgICBlUGlubmVkSGVhZGVyLmFwcGVuZENoaWxkKGhlYWRlckNlbGwpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGVIZWFkZXJDb250YWluZXIuYXBwZW5kQ2hpbGQoaGVhZGVyQ2VsbCk7XHJcbiAgICAgICAgfVxyXG4gICAgfSk7XHJcbn07XHJcblxyXG5IZWFkZXJSZW5kZXJlci5wcm90b3R5cGUuY3JlYXRlSGVhZGVyQ2VsbCA9IGZ1bmN0aW9uKGNvbHVtbiwgZ3JvdXBlZCwgaGVhZGVyR3JvdXApIHtcclxuICAgIHZhciB0aGF0ID0gdGhpcztcclxuICAgIHZhciBjb2xEZWYgPSBjb2x1bW4uY29sRGVmO1xyXG4gICAgdmFyIGVIZWFkZXJDZWxsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcclxuICAgIC8vIHN0aWNrIHRoZSBoZWFkZXIgY2VsbCBpbiBjb2x1bW4sIGFzIHdlIGFjY2VzcyBpdCB3aGVuIGdyb3VwIGlzIHJlLXNpemVkXHJcbiAgICBjb2x1bW4uZUhlYWRlckNlbGwgPSBlSGVhZGVyQ2VsbDtcclxuXHJcbiAgICB2YXIgaGVhZGVyQ2VsbENsYXNzZXMgPSBbJ2FnLWhlYWRlci1jZWxsJ107XHJcbiAgICBpZiAoZ3JvdXBlZCkge1xyXG4gICAgICAgIGhlYWRlckNlbGxDbGFzc2VzLnB1c2goJ2FnLWhlYWRlci1jZWxsLWdyb3VwZWQnKTsgLy8gdGhpcyB0YWtlcyA1MCUgaGVpZ2h0XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIGhlYWRlckNlbGxDbGFzc2VzLnB1c2goJ2FnLWhlYWRlci1jZWxsLW5vdC1ncm91cGVkJyk7IC8vIHRoaXMgdGFrZXMgMTAwJSBoZWlnaHRcclxuICAgIH1cclxuICAgIGVIZWFkZXJDZWxsLmNsYXNzTmFtZSA9IGhlYWRlckNlbGxDbGFzc2VzLmpvaW4oJyAnKTtcclxuXHJcbiAgICAvLyBhZGQgdG9vbHRpcCBpZiBleGlzdHNcclxuICAgIGlmIChjb2xEZWYuaGVhZGVyVG9vbHRpcCkge1xyXG4gICAgICAgIGVIZWFkZXJDZWxsLnRpdGxlID0gY29sRGVmLmhlYWRlclRvb2x0aXA7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHRoaXMuZ3JpZE9wdGlvbnNXcmFwcGVyLmlzRW5hYmxlQ29sUmVzaXplKCkpIHtcclxuICAgICAgICB2YXIgaGVhZGVyQ2VsbFJlc2l6ZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICAgICAgaGVhZGVyQ2VsbFJlc2l6ZS5jbGFzc05hbWUgPSBcImFnLWhlYWRlci1jZWxsLXJlc2l6ZVwiO1xyXG4gICAgICAgIGVIZWFkZXJDZWxsLmFwcGVuZENoaWxkKGhlYWRlckNlbGxSZXNpemUpO1xyXG4gICAgICAgIHZhciBkcmFnQ2FsbGJhY2sgPSB0aGlzLmhlYWRlckRyYWdDYWxsYmFja0ZhY3RvcnkoZUhlYWRlckNlbGwsIGNvbHVtbiwgaGVhZGVyR3JvdXApO1xyXG4gICAgICAgIHRoaXMuYWRkRHJhZ0hhbmRsZXIoaGVhZGVyQ2VsbFJlc2l6ZSwgZHJhZ0NhbGxiYWNrKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBmaWx0ZXIgYnV0dG9uXHJcbiAgICB2YXIgc2hvd01lbnUgPSB0aGlzLmdyaWRPcHRpb25zV3JhcHBlci5pc0VuYWJsZUZpbHRlcigpICYmICFjb2xEZWYuc3VwcHJlc3NNZW51O1xyXG4gICAgaWYgKHNob3dNZW51KSB7XHJcbiAgICAgICAgdmFyIGVNZW51QnV0dG9uID0gdXRpbHMuY3JlYXRlSWNvbignbWVudScsIHRoaXMuZ3JpZE9wdGlvbnNXcmFwcGVyLCBjb2x1bW4sIHN2Z0ZhY3RvcnkuY3JlYXRlTWVudVN2Zyk7XHJcbiAgICAgICAgdXRpbHMuYWRkQ3NzQ2xhc3MoZU1lbnVCdXR0b24sICdhZy1oZWFkZXItaWNvbicpO1xyXG5cclxuICAgICAgICBlTWVudUJ1dHRvbi5zZXRBdHRyaWJ1dGUoXCJjbGFzc1wiLCBcImFnLWhlYWRlci1jZWxsLW1lbnUtYnV0dG9uXCIpO1xyXG4gICAgICAgIGVNZW51QnV0dG9uLm9uY2xpY2sgPSBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgdGhhdC5maWx0ZXJNYW5hZ2VyLnNob3dGaWx0ZXIoY29sdW1uLCB0aGlzKTtcclxuICAgICAgICB9O1xyXG4gICAgICAgIGVIZWFkZXJDZWxsLmFwcGVuZENoaWxkKGVNZW51QnV0dG9uKTtcclxuICAgICAgICBlSGVhZGVyQ2VsbC5vbm1vdXNlZW50ZXIgPSBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgZU1lbnVCdXR0b24uc3R5bGUub3BhY2l0eSA9IDE7XHJcbiAgICAgICAgfTtcclxuICAgICAgICBlSGVhZGVyQ2VsbC5vbm1vdXNlbGVhdmUgPSBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgZU1lbnVCdXR0b24uc3R5bGUub3BhY2l0eSA9IDA7XHJcbiAgICAgICAgfTtcclxuICAgICAgICBlTWVudUJ1dHRvbi5zdHlsZS5vcGFjaXR5ID0gMDtcclxuICAgICAgICBlTWVudUJ1dHRvbi5zdHlsZVtcIi13ZWJraXQtdHJhbnNpdGlvblwiXSA9IFwib3BhY2l0eSAwLjVzLCBib3JkZXIgMC4yc1wiO1xyXG4gICAgICAgIGVNZW51QnV0dG9uLnN0eWxlW1widHJhbnNpdGlvblwiXSA9IFwib3BhY2l0eSAwLjVzLCBib3JkZXIgMC4yc1wiO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIGxhYmVsIGRpdlxyXG4gICAgdmFyIGhlYWRlckNlbGxMYWJlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICBoZWFkZXJDZWxsTGFiZWwuY2xhc3NOYW1lID0gXCJhZy1oZWFkZXItY2VsbC1sYWJlbFwiO1xyXG5cclxuICAgIC8vIGFkZCBpbiBzb3J0IGljb25zXHJcbiAgICBpZiAodGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuaXNFbmFibGVTb3J0aW5nKCkgJiYgIWNvbERlZi5zdXBwcmVzc1NvcnRpbmcpIHtcclxuICAgICAgICBjb2x1bW4uZVNvcnRBc2MgPSB1dGlscy5jcmVhdGVJY29uKCdzb3J0QXNjZW5kaW5nJywgdGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIsIGNvbHVtbiwgc3ZnRmFjdG9yeS5jcmVhdGVBcnJvd1VwU3ZnKTtcclxuICAgICAgICBjb2x1bW4uZVNvcnREZXNjID0gdXRpbHMuY3JlYXRlSWNvbignc29ydERlc2NlbmRpbmcnLCB0aGlzLmdyaWRPcHRpb25zV3JhcHBlciwgY29sdW1uLCBzdmdGYWN0b3J5LmNyZWF0ZUFycm93RG93blN2Zyk7XHJcbiAgICAgICAgdXRpbHMuYWRkQ3NzQ2xhc3MoY29sdW1uLmVTb3J0QXNjLCAnYWctaGVhZGVyLWljb24nKTtcclxuICAgICAgICB1dGlscy5hZGRDc3NDbGFzcyhjb2x1bW4uZVNvcnREZXNjLCAnYWctaGVhZGVyLWljb24nKTtcclxuICAgICAgICBoZWFkZXJDZWxsTGFiZWwuYXBwZW5kQ2hpbGQoY29sdW1uLmVTb3J0QXNjKTtcclxuICAgICAgICBoZWFkZXJDZWxsTGFiZWwuYXBwZW5kQ2hpbGQoY29sdW1uLmVTb3J0RGVzYyk7XHJcbiAgICAgICAgY29sdW1uLmVTb3J0QXNjLnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7XHJcbiAgICAgICAgY29sdW1uLmVTb3J0RGVzYy5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xyXG4gICAgICAgIHRoaXMuYWRkU29ydEhhbmRsaW5nKGhlYWRlckNlbGxMYWJlbCwgY29sdW1uKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBhZGQgaW4gZmlsdGVyIGljb25cclxuICAgIGNvbHVtbi5lRmlsdGVySWNvbiA9IHV0aWxzLmNyZWF0ZUljb24oJ2ZpbHRlcicsIHRoaXMuZ3JpZE9wdGlvbnNXcmFwcGVyLCBjb2x1bW4sIHN2Z0ZhY3RvcnkuY3JlYXRlRmlsdGVyU3ZnKTtcclxuICAgIHV0aWxzLmFkZENzc0NsYXNzKGNvbHVtbi5lRmlsdGVySWNvbiwgJ2FnLWhlYWRlci1pY29uJyk7XHJcbiAgICBoZWFkZXJDZWxsTGFiZWwuYXBwZW5kQ2hpbGQoY29sdW1uLmVGaWx0ZXJJY29uKTtcclxuXHJcbiAgICAvLyByZW5kZXIgdGhlIGNlbGwsIHVzZSBhIHJlbmRlcmVyIGlmIG9uZSBpcyBwcm92aWRlZFxyXG4gICAgdmFyIGhlYWRlckNlbGxSZW5kZXJlcjtcclxuICAgIGlmIChjb2xEZWYuaGVhZGVyQ2VsbFJlbmRlcmVyKSB7IC8vIGZpcnN0IGxvb2sgZm9yIGEgcmVuZGVyZXIgaW4gY29sIGRlZlxyXG4gICAgICAgIGhlYWRlckNlbGxSZW5kZXJlciA9IGNvbERlZi5oZWFkZXJDZWxsUmVuZGVyZXI7XHJcbiAgICB9IGVsc2UgaWYgKHRoaXMuZ3JpZE9wdGlvbnNXcmFwcGVyLmdldEhlYWRlckNlbGxSZW5kZXJlcigpKSB7IC8vIHNlY29uZCBsb29rIGZvciBvbmUgaW4gZ3JpZCBvcHRpb25zXHJcbiAgICAgICAgaGVhZGVyQ2VsbFJlbmRlcmVyID0gdGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuZ2V0SGVhZGVyQ2VsbFJlbmRlcmVyKCk7XHJcbiAgICB9XHJcbiAgICBpZiAoaGVhZGVyQ2VsbFJlbmRlcmVyKSB7XHJcbiAgICAgICAgLy8gcmVuZGVyZXIgcHJvdmlkZWQsIHVzZSBpdFxyXG4gICAgICAgIHZhciBuZXdDaGlsZFNjb3BlO1xyXG4gICAgICAgIGlmICh0aGlzLmdyaWRPcHRpb25zV3JhcHBlci5pc0FuZ3VsYXJDb21waWxlSGVhZGVycygpKSB7XHJcbiAgICAgICAgICAgIG5ld0NoaWxkU2NvcGUgPSB0aGlzLiRzY29wZS4kbmV3KCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHZhciBjZWxsUmVuZGVyZXJQYXJhbXMgPSB7XHJcbiAgICAgICAgICAgIGNvbERlZjogY29sRGVmLFxyXG4gICAgICAgICAgICAkc2NvcGU6IG5ld0NoaWxkU2NvcGUsXHJcbiAgICAgICAgICAgIGNvbnRleHQ6IHRoaXMuZ3JpZE9wdGlvbnNXcmFwcGVyLmdldENvbnRleHQoKSxcclxuICAgICAgICAgICAgZ3JpZE9wdGlvbnM6IHRoaXMuZ3JpZE9wdGlvbnNXcmFwcGVyLmdldEdyaWRPcHRpb25zKClcclxuICAgICAgICB9O1xyXG4gICAgICAgIHZhciBjZWxsUmVuZGVyZXJSZXN1bHQgPSBoZWFkZXJDZWxsUmVuZGVyZXIoY2VsbFJlbmRlcmVyUGFyYW1zKTtcclxuICAgICAgICB2YXIgY2hpbGRUb0FwcGVuZDtcclxuICAgICAgICBpZiAodXRpbHMuaXNOb2RlKGNlbGxSZW5kZXJlclJlc3VsdCkgfHwgdXRpbHMuaXNFbGVtZW50KGNlbGxSZW5kZXJlclJlc3VsdCkpIHtcclxuICAgICAgICAgICAgLy8gYSBkb20gbm9kZSBvciBlbGVtZW50IHdhcyByZXR1cm5lZCwgc28gYWRkIGNoaWxkXHJcbiAgICAgICAgICAgIGNoaWxkVG9BcHBlbmQgPSBjZWxsUmVuZGVyZXJSZXN1bHQ7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgLy8gb3RoZXJ3aXNlIGFzc3VtZSBpdCB3YXMgaHRtbCwgc28ganVzdCBpbnNlcnRcclxuICAgICAgICAgICAgdmFyIGVUZXh0U3BhbiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xyXG4gICAgICAgICAgICBlVGV4dFNwYW4uaW5uZXJIVE1MID0gY2VsbFJlbmRlcmVyUmVzdWx0O1xyXG4gICAgICAgICAgICBjaGlsZFRvQXBwZW5kID0gZVRleHRTcGFuO1xyXG4gICAgICAgIH1cclxuICAgICAgICAvLyBhbmd1bGFyIGNvbXBpbGUgaGVhZGVyIGlmIG9wdGlvbiBpcyB0dXJuZWQgb25cclxuICAgICAgICBpZiAodGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuaXNBbmd1bGFyQ29tcGlsZUhlYWRlcnMoKSkge1xyXG4gICAgICAgICAgICBuZXdDaGlsZFNjb3BlLmNvbERlZiA9IGNvbERlZjtcclxuICAgICAgICAgICAgbmV3Q2hpbGRTY29wZS5jb2xJbmRleCA9IGNvbERlZi5pbmRleDtcclxuICAgICAgICAgICAgbmV3Q2hpbGRTY29wZS5jb2xEZWZXcmFwcGVyID0gY29sdW1uO1xyXG4gICAgICAgICAgICB0aGlzLmNoaWxkU2NvcGVzLnB1c2gobmV3Q2hpbGRTY29wZSk7XHJcbiAgICAgICAgICAgIHZhciBjaGlsZFRvQXBwZW5kQ29tcGlsZWQgPSB0aGlzLiRjb21waWxlKGNoaWxkVG9BcHBlbmQpKG5ld0NoaWxkU2NvcGUpWzBdO1xyXG4gICAgICAgICAgICBoZWFkZXJDZWxsTGFiZWwuYXBwZW5kQ2hpbGQoY2hpbGRUb0FwcGVuZENvbXBpbGVkKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBoZWFkZXJDZWxsTGFiZWwuYXBwZW5kQ2hpbGQoY2hpbGRUb0FwcGVuZCk7XHJcbiAgICAgICAgfVxyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICAvLyBubyByZW5kZXJlciwgZGVmYXVsdCB0ZXh0IHJlbmRlclxyXG4gICAgICAgIHZhciBlSW5uZXJUZXh0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICAgICAgZUlubmVyVGV4dC5jbGFzc05hbWUgPSAnYWctaGVhZGVyLWNlbGwtdGV4dCc7XHJcbiAgICAgICAgZUlubmVyVGV4dC5pbm5lckhUTUwgPSBjb2xEZWYuZGlzcGxheU5hbWU7XHJcbiAgICAgICAgaGVhZGVyQ2VsbExhYmVsLmFwcGVuZENoaWxkKGVJbm5lclRleHQpO1xyXG4gICAgfVxyXG5cclxuICAgIGVIZWFkZXJDZWxsLmFwcGVuZENoaWxkKGhlYWRlckNlbGxMYWJlbCk7XHJcbiAgICBlSGVhZGVyQ2VsbC5zdHlsZS53aWR0aCA9IHV0aWxzLmZvcm1hdFdpZHRoKGNvbHVtbi5hY3R1YWxXaWR0aCk7XHJcblxyXG4gICAgcmV0dXJuIGVIZWFkZXJDZWxsO1xyXG59O1xyXG5cclxuSGVhZGVyUmVuZGVyZXIucHJvdG90eXBlLmFkZFNvcnRIYW5kbGluZyA9IGZ1bmN0aW9uKGhlYWRlckNlbGxMYWJlbCwgY29sRGVmV3JhcHBlcikge1xyXG4gICAgdmFyIHRoYXQgPSB0aGlzO1xyXG5cclxuICAgIGhlYWRlckNlbGxMYWJlbC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgZnVuY3Rpb24oKSB7XHJcblxyXG4gICAgICAgIC8vIHVwZGF0ZSBzb3J0IG9uIGN1cnJlbnQgY29sXHJcbiAgICAgICAgaWYgKGNvbERlZldyYXBwZXIuc29ydCA9PT0gY29uc3RhbnRzLkFTQykge1xyXG4gICAgICAgICAgICBjb2xEZWZXcmFwcGVyLnNvcnQgPSBjb25zdGFudHMuREVTQztcclxuICAgICAgICB9IGVsc2UgaWYgKGNvbERlZldyYXBwZXIuc29ydCA9PT0gY29uc3RhbnRzLkRFU0MpIHtcclxuICAgICAgICAgICAgY29sRGVmV3JhcHBlci5zb3J0ID0gbnVsbFxyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGNvbERlZldyYXBwZXIuc29ydCA9IGNvbnN0YW50cy5BU0M7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBjbGVhciBzb3J0IG9uIGFsbCBjb2x1bW5zIGV4Y2VwdCB0aGlzIG9uZSwgYW5kIHVwZGF0ZSB0aGUgaWNvbnNcclxuICAgICAgICB0aGF0LmNvbHVtbk1vZGVsLmdldEFsbENvbHVtbnMoKS5mb3JFYWNoKGZ1bmN0aW9uKGNvbHVtblRvQ2xlYXIpIHtcclxuICAgICAgICAgICAgaWYgKGNvbHVtblRvQ2xlYXIgIT09IGNvbERlZldyYXBwZXIpIHtcclxuICAgICAgICAgICAgICAgIGNvbHVtblRvQ2xlYXIuc29ydCA9IG51bGw7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIC8vIGNoZWNrIGluIGNhc2Ugbm8gc29ydGluZyBvbiB0aGlzIHBhcnRpY3VsYXIgY29sLCBhcyBzb3J0aW5nIGlzIG9wdGlvbmFsIHBlciBjb2xcclxuICAgICAgICAgICAgaWYgKGNvbHVtblRvQ2xlYXIuY29sRGVmLnN1cHByZXNzU29ydGluZykge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvLyB1cGRhdGUgdmlzaWJpbGl0eSBvZiBpY29uc1xyXG4gICAgICAgICAgICB2YXIgc29ydEFzY2VuZGluZyA9IGNvbHVtblRvQ2xlYXIuc29ydCA9PT0gY29uc3RhbnRzLkFTQztcclxuICAgICAgICAgICAgdmFyIHNvcnREZXNjZW5kaW5nID0gY29sdW1uVG9DbGVhci5zb3J0ID09PSBjb25zdGFudHMuREVTQztcclxuXHJcbiAgICAgICAgICAgIGlmIChjb2x1bW5Ub0NsZWFyLmVTb3J0QXNjKSB7XHJcbiAgICAgICAgICAgICAgICBjb2x1bW5Ub0NsZWFyLmVTb3J0QXNjLnN0eWxlLmRpc3BsYXkgPSBzb3J0QXNjZW5kaW5nID8gJ2lubGluZScgOiAnbm9uZSc7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKGNvbHVtblRvQ2xlYXIuZVNvcnREZXNjKSB7XHJcbiAgICAgICAgICAgICAgICBjb2x1bW5Ub0NsZWFyLmVTb3J0RGVzYy5zdHlsZS5kaXNwbGF5ID0gc29ydERlc2NlbmRpbmcgPyAnaW5saW5lJyA6ICdub25lJztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICB0aGF0LmFuZ3VsYXJHcmlkLnVwZGF0ZU1vZGVsQW5kUmVmcmVzaChjb25zdGFudHMuU1RFUF9TT1JUKTtcclxuICAgIH0pO1xyXG59O1xyXG5cclxuSGVhZGVyUmVuZGVyZXIucHJvdG90eXBlLmdyb3VwRHJhZ0NhbGxiYWNrRmFjdG9yeSA9IGZ1bmN0aW9uKGN1cnJlbnRHcm91cCkge1xyXG4gICAgdmFyIHBhcmVudCA9IHRoaXM7XHJcbiAgICB2YXIgdmlzaWJsZUNvbHVtbnMgPSBjdXJyZW50R3JvdXAudmlzaWJsZUNvbHVtbnM7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIG9uRHJhZ1N0YXJ0OiBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgdGhpcy5ncm91cFdpZHRoU3RhcnQgPSBjdXJyZW50R3JvdXAuYWN0dWFsV2lkdGg7XHJcbiAgICAgICAgICAgIHRoaXMuY2hpbGRyZW5XaWR0aFN0YXJ0cyA9IFtdO1xyXG4gICAgICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgICAgIHZpc2libGVDb2x1bW5zLmZvckVhY2goZnVuY3Rpb24oY29sRGVmV3JhcHBlcikge1xyXG4gICAgICAgICAgICAgICAgdGhhdC5jaGlsZHJlbldpZHRoU3RhcnRzLnB1c2goY29sRGVmV3JhcHBlci5hY3R1YWxXaWR0aCk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB0aGlzLm1pbldpZHRoID0gdmlzaWJsZUNvbHVtbnMubGVuZ3RoICogY29uc3RhbnRzLk1JTl9DT0xfV0lEVEg7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBvbkRyYWdnaW5nOiBmdW5jdGlvbihkcmFnQ2hhbmdlKSB7XHJcblxyXG4gICAgICAgICAgICB2YXIgbmV3V2lkdGggPSB0aGlzLmdyb3VwV2lkdGhTdGFydCArIGRyYWdDaGFuZ2U7XHJcbiAgICAgICAgICAgIGlmIChuZXdXaWR0aCA8IHRoaXMubWluV2lkdGgpIHtcclxuICAgICAgICAgICAgICAgIG5ld1dpZHRoID0gdGhpcy5taW5XaWR0aDtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgLy8gc2V0IHRoZSBuZXcgd2lkdGggdG8gdGhlIGdyb3VwIGhlYWRlclxyXG4gICAgICAgICAgICB2YXIgbmV3V2lkdGhQeCA9IG5ld1dpZHRoICsgXCJweFwiO1xyXG4gICAgICAgICAgICBjdXJyZW50R3JvdXAuZUhlYWRlckdyb3VwQ2VsbC5zdHlsZS53aWR0aCA9IG5ld1dpZHRoUHg7XHJcbiAgICAgICAgICAgIGN1cnJlbnRHcm91cC5hY3R1YWxXaWR0aCA9IG5ld1dpZHRoO1xyXG5cclxuICAgICAgICAgICAgLy8gZGlzdHJpYnV0ZSB0aGUgbmV3IHdpZHRoIHRvIHRoZSBjaGlsZCBoZWFkZXJzXHJcbiAgICAgICAgICAgIHZhciBjaGFuZ2VSYXRpbyA9IG5ld1dpZHRoIC8gdGhpcy5ncm91cFdpZHRoU3RhcnQ7XHJcbiAgICAgICAgICAgIC8vIGtlZXAgdHJhY2sgb2YgcGl4ZWxzIHVzZWQsIGFuZCBsYXN0IGNvbHVtbiBnZXRzIHRoZSByZW1haW5pbmcsXHJcbiAgICAgICAgICAgIC8vIHRvIGNhdGVyIGZvciByb3VuZGluZyBlcnJvcnMsIGFuZCBtaW4gd2lkdGggYWRqdXN0bWVudHNcclxuICAgICAgICAgICAgdmFyIHBpeGVsc1RvRGlzdHJpYnV0ZSA9IG5ld1dpZHRoO1xyXG4gICAgICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgICAgIGN1cnJlbnRHcm91cC52aXNpYmxlQ29sdW1ucy5mb3JFYWNoKGZ1bmN0aW9uKGNvbERlZldyYXBwZXIsIGluZGV4KSB7XHJcbiAgICAgICAgICAgICAgICB2YXIgbm90TGFzdENvbCA9IGluZGV4ICE9PSAodmlzaWJsZUNvbHVtbnMubGVuZ3RoIC0gMSk7XHJcbiAgICAgICAgICAgICAgICB2YXIgbmV3Q2hpbGRTaXplO1xyXG4gICAgICAgICAgICAgICAgaWYgKG5vdExhc3RDb2wpIHtcclxuICAgICAgICAgICAgICAgICAgICAvLyBpZiBub3QgdGhlIGxhc3QgY29sLCBjYWxjdWxhdGUgdGhlIGNvbHVtbiB3aWR0aCBhcyBub3JtYWxcclxuICAgICAgICAgICAgICAgICAgICB2YXIgc3RhcnRDaGlsZFNpemUgPSB0aGF0LmNoaWxkcmVuV2lkdGhTdGFydHNbaW5kZXhdO1xyXG4gICAgICAgICAgICAgICAgICAgIG5ld0NoaWxkU2l6ZSA9IHN0YXJ0Q2hpbGRTaXplICogY2hhbmdlUmF0aW87XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKG5ld0NoaWxkU2l6ZSA8IGNvbnN0YW50cy5NSU5fQ09MX1dJRFRIKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG5ld0NoaWxkU2l6ZSA9IGNvbnN0YW50cy5NSU5fQ09MX1dJRFRIO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBwaXhlbHNUb0Rpc3RyaWJ1dGUgLT0gbmV3Q2hpbGRTaXplO1xyXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAvLyBpZiBsYXN0IGNvbCwgZ2l2ZSBpdCB0aGUgcmVtYWluaW5nIHBpeGVsc1xyXG4gICAgICAgICAgICAgICAgICAgIG5ld0NoaWxkU2l6ZSA9IHBpeGVsc1RvRGlzdHJpYnV0ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIHZhciBlSGVhZGVyQ2VsbCA9IHZpc2libGVDb2x1bW5zW2luZGV4XS5lSGVhZGVyQ2VsbDtcclxuICAgICAgICAgICAgICAgIHBhcmVudC5hZGp1c3RDb2x1bW5XaWR0aChuZXdDaGlsZFNpemUsIGNvbERlZldyYXBwZXIsIGVIZWFkZXJDZWxsKTtcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICAvLyBzaG91bGQgbm90IGJlIGNhbGxpbmcgdGhlc2UgaGVyZSwgc2hvdWxkIGRvIHNvbWV0aGluZyBlbHNlXHJcbiAgICAgICAgICAgIGlmIChjdXJyZW50R3JvdXAucGlubmVkKSB7XHJcbiAgICAgICAgICAgICAgICBwYXJlbnQuYW5ndWxhckdyaWQudXBkYXRlUGlubmVkQ29sQ29udGFpbmVyV2lkdGhBZnRlckNvbFJlc2l6ZSgpO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgcGFyZW50LmFuZ3VsYXJHcmlkLnVwZGF0ZUJvZHlDb250YWluZXJXaWR0aEFmdGVyQ29sUmVzaXplKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9O1xyXG59O1xyXG5cclxuSGVhZGVyUmVuZGVyZXIucHJvdG90eXBlLmFkanVzdENvbHVtbldpZHRoID0gZnVuY3Rpb24obmV3V2lkdGgsIGNvbHVtbiwgZUhlYWRlckNlbGwpIHtcclxuICAgIHZhciBuZXdXaWR0aFB4ID0gbmV3V2lkdGggKyBcInB4XCI7XHJcbiAgICB2YXIgc2VsZWN0b3JGb3JBbGxDb2xzSW5DZWxsID0gXCIuY2VsbC1jb2wtXCIgKyBjb2x1bW4uaW5kZXg7XHJcbiAgICB2YXIgY2VsbHNGb3JUaGlzQ29sID0gdGhpcy5lUm9vdC5xdWVyeVNlbGVjdG9yQWxsKHNlbGVjdG9yRm9yQWxsQ29sc0luQ2VsbCk7XHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGNlbGxzRm9yVGhpc0NvbC5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgIGNlbGxzRm9yVGhpc0NvbFtpXS5zdHlsZS53aWR0aCA9IG5ld1dpZHRoUHg7XHJcbiAgICB9XHJcblxyXG4gICAgZUhlYWRlckNlbGwuc3R5bGUud2lkdGggPSBuZXdXaWR0aFB4O1xyXG4gICAgY29sdW1uLmFjdHVhbFdpZHRoID0gbmV3V2lkdGg7XHJcbn07XHJcblxyXG4vLyBnZXRzIGNhbGxlZCB3aGVuIGEgaGVhZGVyIChub3QgYSBoZWFkZXIgZ3JvdXApIGdldHMgcmVzaXplZFxyXG5IZWFkZXJSZW5kZXJlci5wcm90b3R5cGUuaGVhZGVyRHJhZ0NhbGxiYWNrRmFjdG9yeSA9IGZ1bmN0aW9uKGhlYWRlckNlbGwsIGNvbHVtbiwgaGVhZGVyR3JvdXApIHtcclxuICAgIHZhciBwYXJlbnQgPSB0aGlzO1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgICBvbkRyYWdTdGFydDogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHRoaXMuc3RhcnRXaWR0aCA9IGNvbHVtbi5hY3R1YWxXaWR0aDtcclxuICAgICAgICB9LFxyXG4gICAgICAgIG9uRHJhZ2dpbmc6IGZ1bmN0aW9uKGRyYWdDaGFuZ2UpIHtcclxuICAgICAgICAgICAgdmFyIG5ld1dpZHRoID0gdGhpcy5zdGFydFdpZHRoICsgZHJhZ0NoYW5nZTtcclxuICAgICAgICAgICAgaWYgKG5ld1dpZHRoIDwgY29uc3RhbnRzLk1JTl9DT0xfV0lEVEgpIHtcclxuICAgICAgICAgICAgICAgIG5ld1dpZHRoID0gY29uc3RhbnRzLk1JTl9DT0xfV0lEVEg7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIHBhcmVudC5hZGp1c3RDb2x1bW5XaWR0aChuZXdXaWR0aCwgY29sdW1uLCBoZWFkZXJDZWxsKTtcclxuXHJcbiAgICAgICAgICAgIGlmIChoZWFkZXJHcm91cCkge1xyXG4gICAgICAgICAgICAgICAgcGFyZW50LnNldFdpZHRoT2ZHcm91cEhlYWRlckNlbGwoaGVhZGVyR3JvdXApO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvLyBzaG91bGQgbm90IGJlIGNhbGxpbmcgdGhlc2UgaGVyZSwgc2hvdWxkIGRvIHNvbWV0aGluZyBlbHNlXHJcbiAgICAgICAgICAgIGlmIChjb2x1bW4ucGlubmVkKSB7XHJcbiAgICAgICAgICAgICAgICBwYXJlbnQuYW5ndWxhckdyaWQudXBkYXRlUGlubmVkQ29sQ29udGFpbmVyV2lkdGhBZnRlckNvbFJlc2l6ZSgpO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgcGFyZW50LmFuZ3VsYXJHcmlkLnVwZGF0ZUJvZHlDb250YWluZXJXaWR0aEFmdGVyQ29sUmVzaXplKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9O1xyXG59O1xyXG5cclxuSGVhZGVyUmVuZGVyZXIucHJvdG90eXBlLnN0b3BEcmFnZ2luZyA9IGZ1bmN0aW9uKCkge1xyXG4gICAgdGhpcy5lUm9vdC5zdHlsZS5jdXJzb3IgPSBcIlwiO1xyXG4gICAgdGhpcy5lUm9vdC5vbm1vdXNldXAgPSBudWxsO1xyXG4gICAgdGhpcy5lUm9vdC5vbm1vdXNlbGVhdmUgPSBudWxsO1xyXG4gICAgdGhpcy5lUm9vdC5vbm1vdXNlbW92ZSA9IG51bGw7XHJcbn07XHJcblxyXG5IZWFkZXJSZW5kZXJlci5wcm90b3R5cGUudXBkYXRlRmlsdGVySWNvbnMgPSBmdW5jdGlvbigpIHtcclxuICAgIHZhciB0aGF0ID0gdGhpcztcclxuICAgIHRoaXMuY29sdW1uTW9kZWwuZ2V0VmlzaWJsZUNvbHVtbnMoKS5mb3JFYWNoKGZ1bmN0aW9uKGNvbHVtbikge1xyXG4gICAgICAgIC8vIHRvZG86IG5lZWQgdG8gY2hhbmdlIHRoaXMsIHNvIG9ubHkgdXBkYXRlcyBpZiBjb2x1bW4gaXMgdmlzaWJsZVxyXG4gICAgICAgIGlmIChjb2x1bW4uZUZpbHRlckljb24pIHtcclxuICAgICAgICAgICAgdmFyIGZpbHRlclByZXNlbnQgPSB0aGF0LmZpbHRlck1hbmFnZXIuaXNGaWx0ZXJQcmVzZW50Rm9yQ29sKGNvbHVtbi5jb2xLZXkpO1xyXG4gICAgICAgICAgICB2YXIgZGlzcGxheVN0eWxlID0gZmlsdGVyUHJlc2VudCA/ICdpbmxpbmUnIDogJ25vbmUnO1xyXG4gICAgICAgICAgICBjb2x1bW4uZUZpbHRlckljb24uc3R5bGUuZGlzcGxheSA9IGRpc3BsYXlTdHlsZTtcclxuICAgICAgICB9XHJcbiAgICB9KTtcclxufTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gSGVhZGVyUmVuZGVyZXI7XHJcbiIsInZhciBncm91cENyZWF0b3IgPSByZXF1aXJlKCcuL2dyb3VwQ3JlYXRvcicpO1xyXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzJyk7XHJcbnZhciBjb25zdGFudHMgPSByZXF1aXJlKCcuL2NvbnN0YW50cycpO1xyXG5cclxuZnVuY3Rpb24gSW5NZW1vcnlSb3dDb250cm9sbGVyKCkge1xyXG4gICAgdGhpcy5jcmVhdGVNb2RlbCgpO1xyXG59XHJcblxyXG5Jbk1lbW9yeVJvd0NvbnRyb2xsZXIucHJvdG90eXBlLmluaXQgPSBmdW5jdGlvbihncmlkT3B0aW9uc1dyYXBwZXIsIGNvbHVtbk1vZGVsLCBhbmd1bGFyR3JpZCwgZmlsdGVyTWFuYWdlciwgJHNjb3BlKSB7XHJcbiAgICB0aGlzLmdyaWRPcHRpb25zV3JhcHBlciA9IGdyaWRPcHRpb25zV3JhcHBlcjtcclxuICAgIHRoaXMuY29sdW1uTW9kZWwgPSBjb2x1bW5Nb2RlbDtcclxuICAgIHRoaXMuYW5ndWxhckdyaWQgPSBhbmd1bGFyR3JpZDtcclxuICAgIHRoaXMuZmlsdGVyTWFuYWdlciA9IGZpbHRlck1hbmFnZXI7XHJcbiAgICB0aGlzLiRzY29wZSA9ICRzY29wZTtcclxuXHJcbiAgICB0aGlzLmFsbFJvd3MgPSBudWxsO1xyXG4gICAgdGhpcy5yb3dzQWZ0ZXJHcm91cCA9IG51bGw7XHJcbiAgICB0aGlzLnJvd3NBZnRlckZpbHRlciA9IG51bGw7XHJcbiAgICB0aGlzLnJvd3NBZnRlclNvcnQgPSBudWxsO1xyXG4gICAgdGhpcy5yb3dzQWZ0ZXJNYXAgPSBudWxsO1xyXG59O1xyXG5cclxuLy8gcHJpdmF0ZVxyXG5Jbk1lbW9yeVJvd0NvbnRyb2xsZXIucHJvdG90eXBlLmNyZWF0ZU1vZGVsID0gZnVuY3Rpb24oKSB7XHJcbiAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICB0aGlzLm1vZGVsID0ge1xyXG4gICAgICAgIC8vIHRoaXMgbWV0aG9kIGlzIGltcGxlbWVudGVkIGJ5IHRoZSBpbk1lbW9yeSBtb2RlbCBvbmx5LFxyXG4gICAgICAgIC8vIGl0IGdpdmVzIHRoZSB0b3AgbGV2ZWwgb2YgdGhlIHNlbGVjdGlvbi4gdXNlZCBieSB0aGUgc2VsZWN0aW9uXHJcbiAgICAgICAgLy8gY29udHJvbGxlciwgd2hlbiBpdCBuZWVkcyB0byBkbyBhIGZ1bGwgdHJhdmVyc2FsXHJcbiAgICAgICAgZ2V0VG9wTGV2ZWxOb2RlczogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGF0LnJvd3NBZnRlckdyb3VwO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgZ2V0VmlydHVhbFJvdzogZnVuY3Rpb24oaW5kZXgpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRoYXQucm93c0FmdGVyTWFwW2luZGV4XTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIGdldFZpcnR1YWxSb3dDb3VudDogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIGlmICh0aGF0LnJvd3NBZnRlck1hcCkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoYXQucm93c0FmdGVyTWFwLmxlbmd0aDtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiAwO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxufTtcclxuXHJcbi8vIHB1YmxpY1xyXG5Jbk1lbW9yeVJvd0NvbnRyb2xsZXIucHJvdG90eXBlLmdldE1vZGVsID0gZnVuY3Rpb24oKSB7XHJcbiAgICByZXR1cm4gdGhpcy5tb2RlbDtcclxufTtcclxuXHJcbi8vIHB1YmxpY1xyXG5Jbk1lbW9yeVJvd0NvbnRyb2xsZXIucHJvdG90eXBlLnVwZGF0ZU1vZGVsID0gZnVuY3Rpb24oc3RlcCkge1xyXG5cclxuICAgIC8vIGZhbGx0aHJvdWdoIGluIGJlbG93IHN3aXRjaCBpcyBvbiBwdXJwb3NlXHJcbiAgICBzd2l0Y2ggKHN0ZXApIHtcclxuICAgICAgICBjYXNlIGNvbnN0YW50cy5TVEVQX0VWRVJZVEhJTkc6XHJcbiAgICAgICAgICAgIHRoaXMuZG9Hcm91cGluZygpO1xyXG4gICAgICAgIGNhc2UgY29uc3RhbnRzLlNURVBfRklMVEVSOlxyXG4gICAgICAgICAgICB0aGlzLmRvRmlsdGVyKCk7XHJcbiAgICAgICAgICAgIHRoaXMuZG9BZ2dyZWdhdGUoKTtcclxuICAgICAgICBjYXNlIGNvbnN0YW50cy5TVEVQX1NPUlQ6XHJcbiAgICAgICAgICAgIHRoaXMuZG9Tb3J0KCk7XHJcbiAgICAgICAgY2FzZSBjb25zdGFudHMuU1RFUF9NQVA6XHJcbiAgICAgICAgICAgIHRoaXMuZG9Hcm91cE1hcHBpbmcoKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAodHlwZW9mIHRoaXMuZ3JpZE9wdGlvbnNXcmFwcGVyLmdldE1vZGVsVXBkYXRlZCgpID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgdGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuZ2V0TW9kZWxVcGRhdGVkKCkoKTtcclxuICAgICAgICB2YXIgJHNjb3BlID0gdGhpcy4kc2NvcGU7XHJcbiAgICAgICAgaWYgKCRzY29wZSkge1xyXG4gICAgICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICAgICAgJHNjb3BlLiRhcHBseSgpO1xyXG4gICAgICAgICAgICB9LCAwKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG59O1xyXG5cclxuLy8gcHVibGljIC0gaXQncyBwb3NzaWJsZSB0byByZWNvbXB1dGUgdGhlIGFnZ3JlZ2F0ZSB3aXRob3V0IGRvaW5nIHRoZSBvdGhlciBwYXJ0c1xyXG5Jbk1lbW9yeVJvd0NvbnRyb2xsZXIucHJvdG90eXBlLmRvQWdncmVnYXRlID0gZnVuY3Rpb24oKSB7XHJcblxyXG4gICAgdmFyIGdyb3VwQWdnRnVuY3Rpb24gPSB0aGlzLmdyaWRPcHRpb25zV3JhcHBlci5nZXRHcm91cEFnZ0Z1bmN0aW9uKCk7XHJcbiAgICBpZiAodHlwZW9mIGdyb3VwQWdnRnVuY3Rpb24gIT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5yZWN1cnNpdmVseUNyZWF0ZUFnZ0RhdGEodGhpcy5yb3dzQWZ0ZXJGaWx0ZXIsIGdyb3VwQWdnRnVuY3Rpb24pO1xyXG59O1xyXG5cclxuLy8gcHVibGljXHJcbkluTWVtb3J5Um93Q29udHJvbGxlci5wcm90b3R5cGUuZXhwYW5kT3JDb2xsYXBzZUFsbCA9IGZ1bmN0aW9uKGV4cGFuZCwgcm93Tm9kZXMpIHtcclxuICAgIC8vIGlmIGZpcnN0IGNhbGwgaW4gcmVjdXJzaW9uLCB3ZSBzZXQgbGlzdCB0byBwYXJlbnQgbGlzdFxyXG4gICAgaWYgKHJvd05vZGVzID09PSBudWxsKSB7XHJcbiAgICAgICAgcm93Tm9kZXMgPSB0aGlzLnJvd3NBZnRlckdyb3VwO1xyXG4gICAgfVxyXG5cclxuICAgIGlmICghcm93Tm9kZXMpIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgdmFyIF90aGlzID0gdGhpcztcclxuICAgIHJvd05vZGVzLmZvckVhY2goZnVuY3Rpb24obm9kZSkge1xyXG4gICAgICAgIGlmIChub2RlLmdyb3VwKSB7XHJcbiAgICAgICAgICAgIG5vZGUuZXhwYW5kZWQgPSBleHBhbmQ7XHJcbiAgICAgICAgICAgIF90aGlzLmV4cGFuZE9yQ29sbGFwc2VBbGwoZXhwYW5kLCBub2RlLmNoaWxkcmVuKTtcclxuICAgICAgICB9XHJcbiAgICB9KTtcclxufTtcclxuXHJcbi8vIHByaXZhdGVcclxuSW5NZW1vcnlSb3dDb250cm9sbGVyLnByb3RvdHlwZS5yZWN1cnNpdmVseUNyZWF0ZUFnZ0RhdGEgPSBmdW5jdGlvbihub2RlcywgZ3JvdXBBZ2dGdW5jdGlvbikge1xyXG4gICAgZm9yICh2YXIgaSA9IDAsIGwgPSBub2Rlcy5sZW5ndGg7IGkgPCBsOyBpKyspIHtcclxuICAgICAgICB2YXIgbm9kZSA9IG5vZGVzW2ldO1xyXG4gICAgICAgIGlmIChub2RlLmdyb3VwKSB7XHJcbiAgICAgICAgICAgIC8vIGFnZyBmdW5jdGlvbiBuZWVkcyB0byBzdGFydCBhdCB0aGUgYm90dG9tLCBzbyB0cmF2ZXJzZSBmaXJzdFxyXG4gICAgICAgICAgICB0aGlzLnJlY3Vyc2l2ZWx5Q3JlYXRlQWdnRGF0YShub2RlLmNoaWxkcmVuLCBncm91cEFnZ0Z1bmN0aW9uKTtcclxuICAgICAgICAgICAgLy8gYWZ0ZXIgdHJhdmVyc2FsLCB3ZSBjYW4gbm93IGRvIHRoZSBhZ2cgYXQgdGhpcyBsZXZlbFxyXG4gICAgICAgICAgICB2YXIgZGF0YSA9IGdyb3VwQWdnRnVuY3Rpb24obm9kZS5jaGlsZHJlbik7XHJcbiAgICAgICAgICAgIG5vZGUuZGF0YSA9IGRhdGE7XHJcbiAgICAgICAgICAgIC8vIGlmIHdlIGFyZSBncm91cGluZywgdGhlbiBpdCdzIHBvc3NpYmxlIHRoZXJlIGlzIGEgc2libGluZyBmb290ZXJcclxuICAgICAgICAgICAgLy8gdG8gdGhlIGdyb3VwLCBzbyB1cGRhdGUgdGhlIGRhdGEgaGVyZSBhbHNvIGlmIHRoZXJzIGlzIG9uZVxyXG4gICAgICAgICAgICBpZiAobm9kZS5zaWJsaW5nKSB7XHJcbiAgICAgICAgICAgICAgICBub2RlLnNpYmxpbmcuZGF0YSA9IGRhdGE7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcbn07XHJcblxyXG4vLyBwcml2YXRlXHJcbkluTWVtb3J5Um93Q29udHJvbGxlci5wcm90b3R5cGUuZG9Tb3J0ID0gZnVuY3Rpb24oKSB7XHJcbiAgICAvL3NlZSBpZiB0aGVyZSBpcyBhIGNvbCB3ZSBhcmUgc29ydGluZyBieVxyXG4gICAgdmFyIGNvbHVtbkZvclNvcnRpbmcgPSBudWxsO1xyXG4gICAgdGhpcy5jb2x1bW5Nb2RlbC5nZXRBbGxDb2x1bW5zKCkuZm9yRWFjaChmdW5jdGlvbihjb2xEZWZXcmFwcGVyKSB7XHJcbiAgICAgICAgaWYgKGNvbERlZldyYXBwZXIuc29ydCkge1xyXG4gICAgICAgICAgICBjb2x1bW5Gb3JTb3J0aW5nID0gY29sRGVmV3JhcHBlcjtcclxuICAgICAgICB9XHJcbiAgICB9KTtcclxuXHJcbiAgICB2YXIgcm93Tm9kZXNCZWZvcmVTb3J0ID0gdGhpcy5yb3dzQWZ0ZXJGaWx0ZXIuc2xpY2UoMCk7XHJcblxyXG4gICAgaWYgKGNvbHVtbkZvclNvcnRpbmcpIHtcclxuICAgICAgICB2YXIgYXNjZW5kaW5nID0gY29sdW1uRm9yU29ydGluZy5zb3J0ID09PSBjb25zdGFudHMuQVNDO1xyXG4gICAgICAgIHZhciBpbnZlcnRlciA9IGFzY2VuZGluZyA/IDEgOiAtMTtcclxuXHJcbiAgICAgICAgdGhpcy5zb3J0TGlzdChyb3dOb2Rlc0JlZm9yZVNvcnQsIGNvbHVtbkZvclNvcnRpbmcuY29sRGVmLCBpbnZlcnRlcik7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIC8vaWYgbm8gc29ydGluZywgc2V0IGFsbCBncm91cCBjaGlsZHJlbiBhZnRlciBzb3J0IHRvIHRoZSBvcmlnaW5hbCBsaXN0XHJcbiAgICAgICAgdGhpcy5yZXNldFNvcnRJbkdyb3Vwcyhyb3dOb2Rlc0JlZm9yZVNvcnQpO1xyXG4gICAgfVxyXG5cclxuICAgIHRoaXMucm93c0FmdGVyU29ydCA9IHJvd05vZGVzQmVmb3JlU29ydDtcclxufTtcclxuXHJcbi8vIHByaXZhdGVcclxuSW5NZW1vcnlSb3dDb250cm9sbGVyLnByb3RvdHlwZS5yZXNldFNvcnRJbkdyb3VwcyA9IGZ1bmN0aW9uKHJvd05vZGVzKSB7XHJcbiAgICBmb3IgKHZhciBpID0gMCwgbCA9IHJvd05vZGVzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xyXG4gICAgICAgIHZhciBpdGVtID0gcm93Tm9kZXNbaV07XHJcbiAgICAgICAgaWYgKGl0ZW0uZ3JvdXAgJiYgaXRlbS5jaGlsZHJlbikge1xyXG4gICAgICAgICAgICBpdGVtLmNoaWxkcmVuQWZ0ZXJTb3J0ID0gaXRlbS5jaGlsZHJlbjtcclxuICAgICAgICAgICAgdGhpcy5yZXNldFNvcnRJbkdyb3VwcyhpdGVtLmNoaWxkcmVuKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbn07XHJcblxyXG4vLyBwcml2YXRlXHJcbkluTWVtb3J5Um93Q29udHJvbGxlci5wcm90b3R5cGUuc29ydExpc3QgPSBmdW5jdGlvbihub2RlcywgY29sdW1uRm9yU29ydGluZywgaW52ZXJ0ZXIpIHtcclxuXHJcbiAgICAvLyBzb3J0IGFueSBncm91cHMgcmVjdXJzaXZlbHlcclxuICAgIGZvciAodmFyIGkgPSAwLCBsID0gbm9kZXMubGVuZ3RoOyBpIDwgbDsgaSsrKSB7IC8vIGNyaXRpY2FsIHNlY3Rpb24sIG5vIGZ1bmN0aW9uYWwgcHJvZ3JhbW1pbmdcclxuICAgICAgICB2YXIgbm9kZSA9IG5vZGVzW2ldO1xyXG4gICAgICAgIGlmIChub2RlLmdyb3VwICYmIG5vZGUuY2hpbGRyZW4pIHtcclxuICAgICAgICAgICAgbm9kZS5jaGlsZHJlbkFmdGVyU29ydCA9IG5vZGUuY2hpbGRyZW4uc2xpY2UoMCk7XHJcbiAgICAgICAgICAgIHRoaXMuc29ydExpc3Qobm9kZS5jaGlsZHJlbkFmdGVyU29ydCwgY29sdW1uRm9yU29ydGluZywgaW52ZXJ0ZXIpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBub2Rlcy5zb3J0KGZ1bmN0aW9uKG9iakEsIG9iakIpIHtcclxuICAgICAgICB2YXIga2V5Rm9yU29ydCA9IGNvbHVtbkZvclNvcnRpbmcuZmllbGQ7XHJcbiAgICAgICAgdmFyIHZhbHVlQSA9IG9iakEuZGF0YSA/IG9iakEuZGF0YVtrZXlGb3JTb3J0XSA6IG51bGw7XHJcbiAgICAgICAgdmFyIHZhbHVlQiA9IG9iakIuZGF0YSA/IG9iakIuZGF0YVtrZXlGb3JTb3J0XSA6IG51bGw7XHJcblxyXG4gICAgICAgIGlmIChjb2x1bW5Gb3JTb3J0aW5nLmNvbXBhcmF0b3IpIHtcclxuICAgICAgICAgICAgLy9pZiBjb21wYXJhdG9yIHByb3ZpZGVkLCB1c2UgaXRcclxuICAgICAgICAgICAgcmV0dXJuIGNvbHVtbkZvclNvcnRpbmcuY29tcGFyYXRvcih2YWx1ZUEsIHZhbHVlQikgKiBpbnZlcnRlcjtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAvL290aGVyd2lzZSBkbyBvdXIgb3duIGNvbXBhcmlzb25cclxuICAgICAgICAgICAgcmV0dXJuIHV0aWxzLmRlZmF1bHRDb21wYXJhdG9yKHZhbHVlQSwgdmFsdWVCKSAqIGludmVydGVyO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICB9KTtcclxufTtcclxuXHJcbi8vIHByaXZhdGVcclxuSW5NZW1vcnlSb3dDb250cm9sbGVyLnByb3RvdHlwZS5kb0dyb3VwaW5nID0gZnVuY3Rpb24oKSB7XHJcbiAgICB2YXIgcm93c0FmdGVyR3JvdXA7XHJcbiAgICBpZiAodGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuaXNEb0ludGVybmFsR3JvdXBpbmcoKSkge1xyXG4gICAgICAgIHZhciBleHBhbmRCeURlZmF1bHQgPSB0aGlzLmdyaWRPcHRpb25zV3JhcHBlci5nZXRHcm91cERlZmF1bHRFeHBhbmRlZCgpO1xyXG4gICAgICAgIHJvd3NBZnRlckdyb3VwID0gZ3JvdXBDcmVhdG9yLmdyb3VwKHRoaXMuYWxsUm93cywgdGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuZ2V0R3JvdXBLZXlzKCksXHJcbiAgICAgICAgICAgIHRoaXMuZ3JpZE9wdGlvbnNXcmFwcGVyLmdldEdyb3VwQWdnRnVuY3Rpb24oKSwgZXhwYW5kQnlEZWZhdWx0KTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgcm93c0FmdGVyR3JvdXAgPSB0aGlzLmFsbFJvd3M7XHJcbiAgICB9XHJcbiAgICB0aGlzLnJvd3NBZnRlckdyb3VwID0gcm93c0FmdGVyR3JvdXA7XHJcbn07XHJcblxyXG4vLyBwcml2YXRlXHJcbkluTWVtb3J5Um93Q29udHJvbGxlci5wcm90b3R5cGUuZG9GaWx0ZXIgPSBmdW5jdGlvbigpIHtcclxuICAgIHZhciBxdWlja0ZpbHRlclByZXNlbnQgPSB0aGlzLmFuZ3VsYXJHcmlkLmdldFF1aWNrRmlsdGVyKCkgIT09IG51bGw7XHJcbiAgICB2YXIgYWR2YW5jZWRGaWx0ZXJQcmVzZW50ID0gdGhpcy5maWx0ZXJNYW5hZ2VyLmlzRmlsdGVyUHJlc2VudCgpO1xyXG4gICAgdmFyIGZpbHRlclByZXNlbnQgPSBxdWlja0ZpbHRlclByZXNlbnQgfHwgYWR2YW5jZWRGaWx0ZXJQcmVzZW50O1xyXG5cclxuICAgIHZhciByb3dzQWZ0ZXJGaWx0ZXI7XHJcbiAgICBpZiAoZmlsdGVyUHJlc2VudCkge1xyXG4gICAgICAgIHJvd3NBZnRlckZpbHRlciA9IHRoaXMuZmlsdGVySXRlbXModGhpcy5yb3dzQWZ0ZXJHcm91cCwgcXVpY2tGaWx0ZXJQcmVzZW50LCBhZHZhbmNlZEZpbHRlclByZXNlbnQpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICByb3dzQWZ0ZXJGaWx0ZXIgPSB0aGlzLnJvd3NBZnRlckdyb3VwO1xyXG4gICAgfVxyXG4gICAgdGhpcy5yb3dzQWZ0ZXJGaWx0ZXIgPSByb3dzQWZ0ZXJGaWx0ZXI7XHJcbn07XHJcblxyXG4vLyBwcml2YXRlXHJcbkluTWVtb3J5Um93Q29udHJvbGxlci5wcm90b3R5cGUuZmlsdGVySXRlbXMgPSBmdW5jdGlvbihyb3dOb2RlcywgcXVpY2tGaWx0ZXJQcmVzZW50LCBhZHZhbmNlZEZpbHRlclByZXNlbnQpIHtcclxuICAgIHZhciByZXN1bHQgPSBbXTtcclxuXHJcbiAgICBmb3IgKHZhciBpID0gMCwgbCA9IHJvd05vZGVzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xyXG4gICAgICAgIHZhciBub2RlID0gcm93Tm9kZXNbaV07XHJcblxyXG4gICAgICAgIGlmIChub2RlLmdyb3VwKSB7XHJcbiAgICAgICAgICAgIC8vIGRlYWwgd2l0aCBncm91cFxyXG4gICAgICAgICAgICB2YXIgZmlsdGVyZWRDaGlsZHJlbiA9IHRoaXMuZmlsdGVySXRlbXMobm9kZS5jaGlsZHJlbiwgcXVpY2tGaWx0ZXJQcmVzZW50LCBhZHZhbmNlZEZpbHRlclByZXNlbnQpO1xyXG4gICAgICAgICAgICBpZiAoZmlsdGVyZWRDaGlsZHJlbi5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgICAgICB2YXIgYWxsQ2hpbGRyZW5Db3VudCA9IHRoaXMuZ2V0VG90YWxDaGlsZENvdW50KGZpbHRlcmVkQ2hpbGRyZW4pO1xyXG4gICAgICAgICAgICAgICAgdmFyIG5ld0dyb3VwID0gdGhpcy5jb3B5R3JvdXBOb2RlKG5vZGUsIGZpbHRlcmVkQ2hpbGRyZW4sIGFsbENoaWxkcmVuQ291bnQpO1xyXG5cclxuICAgICAgICAgICAgICAgIHJlc3VsdC5wdXNoKG5ld0dyb3VwKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLmRvZXNSb3dQYXNzRmlsdGVyKG5vZGUsIHF1aWNrRmlsdGVyUHJlc2VudCwgYWR2YW5jZWRGaWx0ZXJQcmVzZW50KSkge1xyXG4gICAgICAgICAgICAgICAgcmVzdWx0LnB1c2gobm9kZSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufTtcclxuXHJcbi8vIHByaXZhdGVcclxuLy8gcm93czogdGhlIHJvd3MgdG8gcHV0IGludG8gdGhlIG1vZGVsXHJcbi8vIGZpcnN0SWQ6IHRoZSBmaXJzdCBpZCB0byB1c2UsIHVzZWQgZm9yIHBhZ2luZywgd2hlcmUgd2UgYXJlIG5vdCBvbiB0aGUgZmlyc3QgcGFnZVxyXG5Jbk1lbW9yeVJvd0NvbnRyb2xsZXIucHJvdG90eXBlLnNldEFsbFJvd3MgPSBmdW5jdGlvbihyb3dzLCBmaXJzdElkKSB7XHJcbiAgICB2YXIgbm9kZXM7XHJcbiAgICBpZiAodGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuaXNSb3dzQWxyZWFkeUdyb3VwZWQoKSkge1xyXG4gICAgICAgIG5vZGVzID0gcm93cztcclxuICAgICAgICB0aGlzLnJlY3Vyc2l2ZWx5Q2hlY2tVc2VyUHJvdmlkZWROb2Rlcyhub2RlcywgbnVsbCwgMCk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIC8vIHBsYWNlIGVhY2ggcm93IGludG8gYSB3cmFwcGVyXHJcbiAgICAgICAgdmFyIG5vZGVzID0gW107XHJcbiAgICAgICAgaWYgKHJvd3MpIHtcclxuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCByb3dzLmxlbmd0aDsgaSsrKSB7IC8vIGNvdWxkIGJlIGxvdHMgb2Ygcm93cywgZG9uJ3QgdXNlIGZ1bmN0aW9uYWwgcHJvZ3JhbW1pbmdcclxuICAgICAgICAgICAgICAgIG5vZGVzLnB1c2goe1xyXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IHJvd3NbaV1cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8vIGlmIGZpcnN0SWQgcHJvdmlkZWQsIHVzZSBpdCwgb3RoZXJ3aXNlIHN0YXJ0IGF0IDBcclxuICAgIHZhciBmaXJzdElkVG9Vc2UgPSBmaXJzdElkID8gZmlyc3RJZCA6IDA7XHJcbiAgICB0aGlzLnJlY3Vyc2l2ZWx5QWRkSWRUb05vZGVzKG5vZGVzLCBmaXJzdElkVG9Vc2UpO1xyXG4gICAgdGhpcy5hbGxSb3dzID0gbm9kZXM7XHJcbn07XHJcblxyXG4vLyBhZGQgaW4gaW5kZXggLSB0aGlzIGlzIHVzZWQgYnkgdGhlIHNlbGVjdGlvbkNvbnRyb2xsZXIgLSBzbyBxdWlja1xyXG4vLyB0byBsb29rIHVwIHNlbGVjdGVkIHJvd3NcclxuSW5NZW1vcnlSb3dDb250cm9sbGVyLnByb3RvdHlwZS5yZWN1cnNpdmVseUFkZElkVG9Ob2RlcyA9IGZ1bmN0aW9uKG5vZGVzLCBpbmRleCkge1xyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBub2Rlcy5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgIHZhciBub2RlID0gbm9kZXNbaV07XHJcbiAgICAgICAgbm9kZS5pZCA9IGluZGV4Kys7XHJcbiAgICAgICAgaWYgKG5vZGUuZ3JvdXAgJiYgbm9kZS5jaGlsZHJlbikge1xyXG4gICAgICAgICAgICBpbmRleCA9IHRoaXMucmVjdXJzaXZlbHlBZGRJZFRvTm9kZXMobm9kZS5jaGlsZHJlbiwgaW5kZXgpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIHJldHVybiBpbmRleDtcclxufTtcclxuXHJcbi8vIGFkZCBpbiBpbmRleCAtIHRoaXMgaXMgdXNlZCBieSB0aGUgc2VsZWN0aW9uQ29udHJvbGxlciAtIHNvIHF1aWNrXHJcbi8vIHRvIGxvb2sgdXAgc2VsZWN0ZWQgcm93c1xyXG5Jbk1lbW9yeVJvd0NvbnRyb2xsZXIucHJvdG90eXBlLnJlY3Vyc2l2ZWx5Q2hlY2tVc2VyUHJvdmlkZWROb2RlcyA9IGZ1bmN0aW9uKG5vZGVzLCBwYXJlbnQsIGxldmVsKSB7XHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IG5vZGVzLmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgdmFyIG5vZGUgPSBub2Rlc1tpXTtcclxuICAgICAgICBpZiAocGFyZW50KSB7XHJcbiAgICAgICAgICAgIG5vZGUucGFyZW50ID0gcGFyZW50O1xyXG4gICAgICAgIH1cclxuICAgICAgICBub2RlLmxldmVsID0gbGV2ZWw7XHJcbiAgICAgICAgaWYgKG5vZGUuZ3JvdXAgJiYgbm9kZS5jaGlsZHJlbikge1xyXG4gICAgICAgICAgICB0aGlzLnJlY3Vyc2l2ZWx5Q2hlY2tVc2VyUHJvdmlkZWROb2Rlcyhub2RlLmNoaWxkcmVuLCBub2RlLCBsZXZlbCArIDEpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxufTtcclxuXHJcbi8vIHByaXZhdGVcclxuSW5NZW1vcnlSb3dDb250cm9sbGVyLnByb3RvdHlwZS5nZXRUb3RhbENoaWxkQ291bnQgPSBmdW5jdGlvbihyb3dOb2Rlcykge1xyXG4gICAgdmFyIGNvdW50ID0gMDtcclxuICAgIGZvciAodmFyIGkgPSAwLCBsID0gcm93Tm9kZXMubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XHJcbiAgICAgICAgdmFyIGl0ZW0gPSByb3dOb2Rlc1tpXTtcclxuICAgICAgICBpZiAoaXRlbS5ncm91cCkge1xyXG4gICAgICAgICAgICBjb3VudCArPSBpdGVtLmFsbENoaWxkcmVuQ291bnQ7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgY291bnQrKztcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gY291bnQ7XHJcbn07XHJcblxyXG4vLyBwcml2YXRlXHJcbkluTWVtb3J5Um93Q29udHJvbGxlci5wcm90b3R5cGUuY29weUdyb3VwTm9kZSA9IGZ1bmN0aW9uKGdyb3VwTm9kZSwgY2hpbGRyZW4sIGFsbENoaWxkcmVuQ291bnQpIHtcclxuICAgIHJldHVybiB7XHJcbiAgICAgICAgZ3JvdXA6IHRydWUsXHJcbiAgICAgICAgZGF0YTogZ3JvdXBOb2RlLmRhdGEsXHJcbiAgICAgICAgZmllbGQ6IGdyb3VwTm9kZS5maWVsZCxcclxuICAgICAgICBrZXk6IGdyb3VwTm9kZS5rZXksXHJcbiAgICAgICAgZXhwYW5kZWQ6IGdyb3VwTm9kZS5leHBhbmRlZCxcclxuICAgICAgICBjaGlsZHJlbjogY2hpbGRyZW4sXHJcbiAgICAgICAgYWxsQ2hpbGRyZW5Db3VudDogYWxsQ2hpbGRyZW5Db3VudCxcclxuICAgICAgICBsZXZlbDogZ3JvdXBOb2RlLmxldmVsXHJcbiAgICB9O1xyXG59O1xyXG5cclxuLy8gcHJpdmF0ZVxyXG5Jbk1lbW9yeVJvd0NvbnRyb2xsZXIucHJvdG90eXBlLmRvR3JvdXBNYXBwaW5nID0gZnVuY3Rpb24oKSB7XHJcbiAgICAvLyBldmVuIGlmIG5vdCBnb2luZyBncm91cGluZywgd2UgZG8gdGhlIG1hcHBpbmcsIGFzIHRoZSBjbGllbnQgbWlnaHRcclxuICAgIC8vIG9mIHBhc3NlZCBpbiBkYXRhIHRoYXQgYWxyZWFkeSBoYXMgYSBncm91cGluZyBpbiBpdCBzb21ld2hlcmVcclxuICAgIHZhciByb3dzQWZ0ZXJNYXAgPSBbXTtcclxuICAgIHRoaXMuYWRkVG9NYXAocm93c0FmdGVyTWFwLCB0aGlzLnJvd3NBZnRlclNvcnQpO1xyXG4gICAgdGhpcy5yb3dzQWZ0ZXJNYXAgPSByb3dzQWZ0ZXJNYXA7XHJcbn07XHJcblxyXG4vLyBwcml2YXRlXHJcbkluTWVtb3J5Um93Q29udHJvbGxlci5wcm90b3R5cGUuYWRkVG9NYXAgPSBmdW5jdGlvbihtYXBwZWREYXRhLCBvcmlnaW5hbE5vZGVzKSB7XHJcbiAgICBpZiAoIW9yaWdpbmFsTm9kZXMpIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IG9yaWdpbmFsTm9kZXMubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICB2YXIgbm9kZSA9IG9yaWdpbmFsTm9kZXNbaV07XHJcbiAgICAgICAgbWFwcGVkRGF0YS5wdXNoKG5vZGUpO1xyXG4gICAgICAgIGlmIChub2RlLmdyb3VwICYmIG5vZGUuZXhwYW5kZWQpIHtcclxuICAgICAgICAgICAgdGhpcy5hZGRUb01hcChtYXBwZWREYXRhLCBub2RlLmNoaWxkcmVuQWZ0ZXJTb3J0KTtcclxuXHJcbiAgICAgICAgICAgIC8vIHB1dCBhIGZvb3RlciBpbiBpZiB1c2VyIGlzIGxvb2tpbmcgZm9yIGl0XHJcbiAgICAgICAgICAgIGlmICh0aGlzLmdyaWRPcHRpb25zV3JhcHBlci5pc0dyb3VwSW5jbHVkZUZvb3RlcigpKSB7XHJcbiAgICAgICAgICAgICAgICB2YXIgZm9vdGVyTm9kZSA9IHRoaXMuY3JlYXRlRm9vdGVyTm9kZShub2RlKTtcclxuICAgICAgICAgICAgICAgIG1hcHBlZERhdGEucHVzaChmb290ZXJOb2RlKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxufTtcclxuXHJcbi8vIHByaXZhdGVcclxuSW5NZW1vcnlSb3dDb250cm9sbGVyLnByb3RvdHlwZS5jcmVhdGVGb290ZXJOb2RlID0gZnVuY3Rpb24oZ3JvdXBOb2RlKSB7XHJcbiAgICB2YXIgZm9vdGVyTm9kZSA9IHt9O1xyXG4gICAgT2JqZWN0LmtleXMoZ3JvdXBOb2RlKS5mb3JFYWNoKGZ1bmN0aW9uKGtleSkge1xyXG4gICAgICAgIGZvb3Rlck5vZGVba2V5XSA9IGdyb3VwTm9kZVtrZXldO1xyXG4gICAgfSk7XHJcbiAgICBmb290ZXJOb2RlLmZvb3RlciA9IHRydWU7XHJcbiAgICAvLyBnZXQgYm90aCBoZWFkZXIgYW5kIGZvb3RlciB0byByZWZlcmVuY2UgZWFjaCBvdGhlciBhcyBzaWJsaW5ncy4gdGhpcyBpcyBuZXZlciB1bmRvbmUsXHJcbiAgICAvLyBvbmx5IG92ZXJ3cml0dGVuLiBzbyBpZiBhIGdyb3VwIGlzIGV4cGFuZGVkLCB0aGVuIGNvbnRyYWN0ZWQsIGl0IHdpbGwgaGF2ZSBhIGdob3N0XHJcbiAgICAvLyBzaWJsaW5nIC0gYnV0IHRoYXQncyBmaW5lLCBhcyB3ZSBjYW4gaWdub3JlIHRoaXMgaWYgdGhlIGhlYWRlciBpcyBjb250cmFjdGVkLlxyXG4gICAgZm9vdGVyTm9kZS5zaWJsaW5nID0gZ3JvdXBOb2RlO1xyXG4gICAgZ3JvdXBOb2RlLnNpYmxpbmcgPSBmb290ZXJOb2RlO1xyXG4gICAgcmV0dXJuIGZvb3Rlck5vZGU7XHJcbn07XHJcblxyXG4vLyBwcml2YXRlXHJcbkluTWVtb3J5Um93Q29udHJvbGxlci5wcm90b3R5cGUuZG9lc1Jvd1Bhc3NGaWx0ZXIgPSBmdW5jdGlvbihub2RlLCBxdWlja0ZpbHRlclByZXNlbnQsIGFkdmFuY2VkRmlsdGVyUHJlc2VudCkge1xyXG4gICAgLy9maXJzdCB1cCwgY2hlY2sgcXVpY2sgZmlsdGVyXHJcbiAgICBpZiAocXVpY2tGaWx0ZXJQcmVzZW50KSB7XHJcbiAgICAgICAgaWYgKCFub2RlLnF1aWNrRmlsdGVyQWdncmVnYXRlVGV4dCkge1xyXG4gICAgICAgICAgICB0aGlzLmFnZ3JlZ2F0ZVJvd0ZvclF1aWNrRmlsdGVyKG5vZGUpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAobm9kZS5xdWlja0ZpbHRlckFnZ3JlZ2F0ZVRleHQuaW5kZXhPZih0aGlzLmFuZ3VsYXJHcmlkLmdldFF1aWNrRmlsdGVyKCkpIDwgMCkge1xyXG4gICAgICAgICAgICAvL3F1aWNrIGZpbHRlciBmYWlscywgc28gc2tpcCBpdGVtXHJcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLy9zZWNvbmQsIGNoZWNrIGFkdmFuY2VkIGZpbHRlclxyXG4gICAgaWYgKGFkdmFuY2VkRmlsdGVyUHJlc2VudCkge1xyXG4gICAgICAgIGlmICghdGhpcy5maWx0ZXJNYW5hZ2VyLmRvZXNGaWx0ZXJQYXNzKG5vZGUpKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLy9nb3QgdGhpcyBmYXIsIGFsbCBmaWx0ZXJzIHBhc3NcclxuICAgIHJldHVybiB0cnVlO1xyXG59O1xyXG5cclxuLy8gcHJpdmF0ZVxyXG5Jbk1lbW9yeVJvd0NvbnRyb2xsZXIucHJvdG90eXBlLmFnZ3JlZ2F0ZVJvd0ZvclF1aWNrRmlsdGVyID0gZnVuY3Rpb24obm9kZSkge1xyXG4gICAgdmFyIGFnZ3JlZ2F0ZWRUZXh0ID0gJyc7XHJcbiAgICB0aGlzLmNvbHVtbk1vZGVsLmdldEFsbENvbHVtbnMoKS5mb3JFYWNoKGZ1bmN0aW9uKGNvbERlZldyYXBwZXIpIHtcclxuICAgICAgICB2YXIgZGF0YSA9IG5vZGUuZGF0YTtcclxuICAgICAgICB2YXIgdmFsdWUgPSBkYXRhID8gZGF0YVtjb2xEZWZXcmFwcGVyLmNvbERlZi5maWVsZF0gOiBudWxsO1xyXG4gICAgICAgIGlmICh2YWx1ZSAmJiB2YWx1ZSAhPT0gJycpIHtcclxuICAgICAgICAgICAgYWdncmVnYXRlZFRleHQgPSBhZ2dyZWdhdGVkVGV4dCArIHZhbHVlLnRvU3RyaW5nKCkudG9VcHBlckNhc2UoKSArIFwiX1wiO1xyXG4gICAgICAgIH1cclxuICAgIH0pO1xyXG4gICAgbm9kZS5xdWlja0ZpbHRlckFnZ3JlZ2F0ZVRleHQgPSBhZ2dyZWdhdGVkVGV4dDtcclxufTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gSW5NZW1vcnlSb3dDb250cm9sbGVyO1xyXG4iLCJ2YXIgVEVNUExBVEUgPSBbXHJcbiAgICAnPHNwYW4gaWQ9XCJwYWdlUm93U3VtbWFyeVBhbmVsXCIgY2xhc3M9XCJhZy1wYWdpbmctcm93LXN1bW1hcnktcGFuZWxcIj4nLFxyXG4gICAgJzxzcGFuIGlkPVwiZmlyc3RSb3dPblBhZ2VcIj48L3NwYW4+JyxcclxuICAgICcgdG8gJyxcclxuICAgICc8c3BhbiBpZD1cImxhc3RSb3dPblBhZ2VcIj48L3NwYW4+JyxcclxuICAgICcgb2YgJyxcclxuICAgICc8c3BhbiBpZD1cInJlY29yZENvdW50XCI+PC9zcGFuPicsXHJcbiAgICAnPC9zcGFuPicsXHJcbiAgICAnPHNwYW4gY2xhcz1cImFnLXBhZ2luZy1wYWdlLXN1bW1hcnktcGFuZWxcIj4nLFxyXG4gICAgJzxidXR0b24gY2xhc3M9XCJhZy1wYWdpbmctYnV0dG9uXCIgaWQ9XCJidEZpcnN0XCI+Rmlyc3Q8L2J1dHRvbj4nLFxyXG4gICAgJzxidXR0b24gY2xhc3M9XCJhZy1wYWdpbmctYnV0dG9uXCIgaWQ9XCJidFByZXZpb3VzXCI+UHJldmlvdXM8L2J1dHRvbj4nLFxyXG4gICAgJyBQYWdlICcsXHJcbiAgICAnPHNwYW4gaWQ9XCJjdXJyZW50XCI+PC9zcGFuPicsXHJcbiAgICAnIG9mICcsXHJcbiAgICAnPHNwYW4gaWQ9XCJ0b3RhbFwiPjwvc3Bhbj4nLFxyXG4gICAgJzxidXR0b24gY2xhc3M9XCJhZy1wYWdpbmctYnV0dG9uXCIgaWQ9XCJidE5leHRcIj5OZXh0PC9idXR0b24+JyxcclxuICAgICc8YnV0dG9uIGNsYXNzPVwiYWctcGFnaW5nLWJ1dHRvblwiIGlkPVwiYnRMYXN0XCI+TGFzdDwvYnV0dG9uPicsXHJcbiAgICAnPC9zcGFuPidcclxuXS5qb2luKCcnKTtcclxuXHJcbmZ1bmN0aW9uIFBhZ2luYXRpb25Db250cm9sbGVyKCkge31cclxuXHJcblBhZ2luYXRpb25Db250cm9sbGVyLnByb3RvdHlwZS5pbml0ID0gZnVuY3Rpb24oZVBhZ2luZ1BhbmVsLCBhbmd1bGFyR3JpZCkge1xyXG4gICAgdGhpcy5hbmd1bGFyR3JpZCA9IGFuZ3VsYXJHcmlkO1xyXG4gICAgdGhpcy5wb3B1bGF0ZVBhbmVsKGVQYWdpbmdQYW5lbCk7XHJcbiAgICB0aGlzLmNhbGxWZXJzaW9uID0gMDtcclxufTtcclxuXHJcblBhZ2luYXRpb25Db250cm9sbGVyLnByb3RvdHlwZS5zZXREYXRhc291cmNlID0gZnVuY3Rpb24oZGF0YXNvdXJjZSkge1xyXG4gICAgdGhpcy5kYXRhc291cmNlID0gZGF0YXNvdXJjZTtcclxuXHJcbiAgICBpZiAoIWRhdGFzb3VyY2UpIHtcclxuICAgICAgICAvLyBvbmx5IGNvbnRpbnVlIGlmIHdlIGhhdmUgYSB2YWxpZCBkYXRhc291cmNlIHRvIHdvcmsgd2l0aFxyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICB0aGlzLnJlc2V0KCk7XHJcbn07XHJcblxyXG5QYWdpbmF0aW9uQ29udHJvbGxlci5wcm90b3R5cGUucmVzZXQgPSBmdW5jdGlvbigpIHtcclxuICAgIC8vIGNvcHkgcGFnZVNpemUsIHRvIGd1YXJkIGFnYWluc3QgaXQgY2hhbmdpbmcgdGhlIHRoZSBkYXRhc291cmNlIGJldHdlZW4gY2FsbHNcclxuICAgIHRoaXMucGFnZVNpemUgPSB0aGlzLmRhdGFzb3VyY2UucGFnZVNpemU7XHJcbiAgICAvLyBzZWUgaWYgd2Uga25vdyB0aGUgdG90YWwgbnVtYmVyIG9mIHBhZ2VzLCBvciBpZiBpdCdzICd0byBiZSBkZWNpZGVkJ1xyXG4gICAgaWYgKHRoaXMuZGF0YXNvdXJjZS5yb3dDb3VudCA+PSAwKSB7XHJcbiAgICAgICAgdGhpcy5yb3dDb3VudCA9IHRoaXMuZGF0YXNvdXJjZS5yb3dDb3VudDtcclxuICAgICAgICB0aGlzLmZvdW5kTWF4Um93ID0gdHJ1ZTtcclxuICAgICAgICB0aGlzLmNhbGN1bGF0ZVRvdGFsUGFnZXMoKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdGhpcy5yb3dDb3VudCA9IDA7XHJcbiAgICAgICAgdGhpcy5mb3VuZE1heFJvdyA9IGZhbHNlO1xyXG4gICAgICAgIHRoaXMudG90YWxQYWdlcyA9IG51bGw7XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5jdXJyZW50UGFnZSA9IDA7XHJcblxyXG4gICAgLy8gaGlkZSB0aGUgc3VtbWFyeSBwYW5lbCB1bnRpbCBzb21ldGhpbmcgaXMgbG9hZGVkXHJcbiAgICB0aGlzLmVQYWdlUm93U3VtbWFyeVBhbmVsLnN0eWxlLnZpc2liaWxpdHkgPSAnaGlkZGVuJztcclxuXHJcbiAgICB0aGlzLnNldFRvdGFsTGFiZWxzKCk7XHJcbiAgICB0aGlzLmxvYWRQYWdlKCk7XHJcbn07XHJcblxyXG5QYWdpbmF0aW9uQ29udHJvbGxlci5wcm90b3R5cGUuc2V0VG90YWxMYWJlbHMgPSBmdW5jdGlvbigpIHtcclxuICAgIGlmICh0aGlzLmZvdW5kTWF4Um93KSB7XHJcbiAgICAgICAgdGhpcy5sYlRvdGFsLmlubmVySFRNTCA9IHRoaXMudG90YWxQYWdlcy50b0xvY2FsZVN0cmluZygpO1xyXG4gICAgICAgIHRoaXMubGJSZWNvcmRDb3VudC5pbm5lckhUTUwgPSB0aGlzLnJvd0NvdW50LnRvTG9jYWxlU3RyaW5nKCk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHRoaXMubGJUb3RhbC5pbm5lckhUTUwgPSAnbW9yZSc7XHJcbiAgICAgICAgdGhpcy5sYlJlY29yZENvdW50LmlubmVySFRNTCA9ICdtb3JlJztcclxuICAgIH1cclxufTtcclxuXHJcblBhZ2luYXRpb25Db250cm9sbGVyLnByb3RvdHlwZS5jYWxjdWxhdGVUb3RhbFBhZ2VzID0gZnVuY3Rpb24oKSB7XHJcbiAgICB0aGlzLnRvdGFsUGFnZXMgPSBNYXRoLmZsb29yKCh0aGlzLnJvd0NvdW50IC0gMSkgLyB0aGlzLnBhZ2VTaXplKSArIDE7XHJcbn07XHJcblxyXG5QYWdpbmF0aW9uQ29udHJvbGxlci5wcm90b3R5cGUucGFnZUxvYWRlZCA9IGZ1bmN0aW9uKHJvd3MsIGxhc3RSb3dJbmRleCkge1xyXG4gICAgdmFyIGZpcnN0SWQgPSB0aGlzLmN1cnJlbnRQYWdlICogdGhpcy5wYWdlU2l6ZTtcclxuICAgIHRoaXMuYW5ndWxhckdyaWQuc2V0Um93cyhyb3dzLCBmaXJzdElkKTtcclxuICAgIC8vIHNlZSBpZiB3ZSBoaXQgdGhlIGxhc3Qgcm93XHJcbiAgICBpZiAoIXRoaXMuZm91bmRNYXhSb3cgJiYgdHlwZW9mIGxhc3RSb3dJbmRleCA9PT0gJ251bWJlcicgJiYgbGFzdFJvd0luZGV4ID49IDApIHtcclxuICAgICAgICB0aGlzLmZvdW5kTWF4Um93ID0gdHJ1ZTtcclxuICAgICAgICB0aGlzLnJvd0NvdW50ID0gbGFzdFJvd0luZGV4O1xyXG4gICAgICAgIHRoaXMuY2FsY3VsYXRlVG90YWxQYWdlcygpO1xyXG4gICAgICAgIHRoaXMuc2V0VG90YWxMYWJlbHMoKTtcclxuXHJcbiAgICAgICAgLy8gaWYgb3ZlcnNob3QgcGFnZXMsIGdvIGJhY2tcclxuICAgICAgICBpZiAodGhpcy5jdXJyZW50UGFnZSA+IHRoaXMudG90YWxQYWdlcykge1xyXG4gICAgICAgICAgICB0aGlzLmN1cnJlbnRQYWdlID0gdGhpcy50b3RhbFBhZ2VzIC0gMTtcclxuICAgICAgICAgICAgdGhpcy5sb2FkUGFnZSgpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIHRoaXMuZW5hYmxlT3JEaXNhYmxlQnV0dG9ucygpO1xyXG4gICAgdGhpcy51cGRhdGVSb3dMYWJlbHMoKTtcclxufTtcclxuXHJcblBhZ2luYXRpb25Db250cm9sbGVyLnByb3RvdHlwZS51cGRhdGVSb3dMYWJlbHMgPSBmdW5jdGlvbigpIHtcclxuICAgIHZhciBzdGFydFJvdyA9ICh0aGlzLnBhZ2VTaXplICogdGhpcy5jdXJyZW50UGFnZSkgKyAxO1xyXG4gICAgdmFyIGVuZFJvdyA9IHN0YXJ0Um93ICsgdGhpcy5wYWdlU2l6ZSAtIDE7XHJcbiAgICBpZiAodGhpcy5mb3VuZE1heFJvdyAmJiBlbmRSb3cgPiB0aGlzLnJvd0NvdW50KSB7XHJcbiAgICAgICAgZW5kUm93ID0gdGhpcy5yb3dDb3VudDtcclxuICAgIH1cclxuICAgIHRoaXMubGJGaXJzdFJvd09uUGFnZS5pbm5lckhUTUwgPSAoc3RhcnRSb3cpLnRvTG9jYWxlU3RyaW5nKCk7XHJcbiAgICB0aGlzLmxiTGFzdFJvd09uUGFnZS5pbm5lckhUTUwgPSAoZW5kUm93KS50b0xvY2FsZVN0cmluZygpO1xyXG5cclxuICAgIC8vIHNob3cgdGhlIHN1bW1hcnkgcGFuZWwsIHdoZW4gZmlyc3Qgc2hvd24sIHRoaXMgaXMgYmxhbmtcclxuICAgIHRoaXMuZVBhZ2VSb3dTdW1tYXJ5UGFuZWwuc3R5bGUudmlzaWJpbGl0eSA9IG51bGw7XHJcbn07XHJcblxyXG5QYWdpbmF0aW9uQ29udHJvbGxlci5wcm90b3R5cGUubG9hZFBhZ2UgPSBmdW5jdGlvbigpIHtcclxuICAgIHRoaXMuZW5hYmxlT3JEaXNhYmxlQnV0dG9ucygpO1xyXG4gICAgdmFyIHN0YXJ0Um93ID0gdGhpcy5jdXJyZW50UGFnZSAqIHRoaXMuZGF0YXNvdXJjZS5wYWdlU2l6ZTtcclxuICAgIHZhciBlbmRSb3cgPSAodGhpcy5jdXJyZW50UGFnZSArIDEpICogdGhpcy5kYXRhc291cmNlLnBhZ2VTaXplO1xyXG5cclxuICAgIHRoaXMubGJDdXJyZW50LmlubmVySFRNTCA9ICh0aGlzLmN1cnJlbnRQYWdlICsgMSkudG9Mb2NhbGVTdHJpbmcoKTtcclxuXHJcbiAgICB0aGlzLmNhbGxWZXJzaW9uKys7XHJcbiAgICB2YXIgY2FsbFZlcnNpb25Db3B5ID0gdGhpcy5jYWxsVmVyc2lvbjtcclxuICAgIHZhciB0aGF0ID0gdGhpcztcclxuICAgIHRoaXMuYW5ndWxhckdyaWQuc2hvd0xvYWRpbmdQYW5lbCh0cnVlKTtcclxuICAgIHRoaXMuZGF0YXNvdXJjZS5nZXRSb3dzKHN0YXJ0Um93LCBlbmRSb3csXHJcbiAgICAgICAgZnVuY3Rpb24gc3VjY2Vzcyhyb3dzLCBsYXN0Um93SW5kZXgpIHtcclxuICAgICAgICAgICAgaWYgKHRoYXQuaXNDYWxsRGFlbW9uKGNhbGxWZXJzaW9uQ29weSkpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB0aGF0LnBhZ2VMb2FkZWQocm93cywgbGFzdFJvd0luZGV4KTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIGZ1bmN0aW9uIGZhaWwoKSB7XHJcbiAgICAgICAgICAgIGlmICh0aGF0LmlzQ2FsbERhZW1vbihjYWxsVmVyc2lvbkNvcHkpKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgLy8gc2V0IGluIGFuIGVtcHR5IHNldCBvZiByb3dzLCB0aGlzIHdpbGwgYXRcclxuICAgICAgICAgICAgLy8gbGVhc3QgZ2V0IHJpZCBvZiB0aGUgbG9hZGluZyBwYW5lbCwgYW5kXHJcbiAgICAgICAgICAgIC8vIHN0b3AgYmxvY2tpbmcgdGhpbmdzXHJcbiAgICAgICAgICAgIHRoYXQuYW5ndWxhckdyaWQuc2V0Um93cyhbXSk7XHJcbiAgICAgICAgfVxyXG4gICAgKTtcclxufTtcclxuXHJcblBhZ2luYXRpb25Db250cm9sbGVyLnByb3RvdHlwZS5pc0NhbGxEYWVtb24gPSBmdW5jdGlvbih2ZXJzaW9uQ29weSkge1xyXG4gICAgcmV0dXJuIHZlcnNpb25Db3B5ICE9PSB0aGlzLmNhbGxWZXJzaW9uO1xyXG59O1xyXG5cclxuUGFnaW5hdGlvbkNvbnRyb2xsZXIucHJvdG90eXBlLm9uQnROZXh0ID0gZnVuY3Rpb24oKSB7XHJcbiAgICB0aGlzLmN1cnJlbnRQYWdlKys7XHJcbiAgICB0aGlzLmxvYWRQYWdlKCk7XHJcbn07XHJcblxyXG5QYWdpbmF0aW9uQ29udHJvbGxlci5wcm90b3R5cGUub25CdFByZXZpb3VzID0gZnVuY3Rpb24oKSB7XHJcbiAgICB0aGlzLmN1cnJlbnRQYWdlLS07XHJcbiAgICB0aGlzLmxvYWRQYWdlKCk7XHJcbn07XHJcblxyXG5QYWdpbmF0aW9uQ29udHJvbGxlci5wcm90b3R5cGUub25CdEZpcnN0ID0gZnVuY3Rpb24oKSB7XHJcbiAgICB0aGlzLmN1cnJlbnRQYWdlID0gMDtcclxuICAgIHRoaXMubG9hZFBhZ2UoKTtcclxufTtcclxuXHJcblBhZ2luYXRpb25Db250cm9sbGVyLnByb3RvdHlwZS5vbkJ0TGFzdCA9IGZ1bmN0aW9uKCkge1xyXG4gICAgdGhpcy5jdXJyZW50UGFnZSA9IHRoaXMudG90YWxQYWdlcyAtIDE7XHJcbiAgICB0aGlzLmxvYWRQYWdlKCk7XHJcbn07XHJcblxyXG5QYWdpbmF0aW9uQ29udHJvbGxlci5wcm90b3R5cGUuZW5hYmxlT3JEaXNhYmxlQnV0dG9ucyA9IGZ1bmN0aW9uKCkge1xyXG4gICAgdmFyIGRpc2FibGVQcmV2aW91c0FuZEZpcnN0ID0gdGhpcy5jdXJyZW50UGFnZSA9PT0gMDtcclxuICAgIHRoaXMuYnRQcmV2aW91cy5kaXNhYmxlZCA9IGRpc2FibGVQcmV2aW91c0FuZEZpcnN0O1xyXG4gICAgdGhpcy5idEZpcnN0LmRpc2FibGVkID0gZGlzYWJsZVByZXZpb3VzQW5kRmlyc3Q7XHJcblxyXG4gICAgdmFyIGRpc2FibGVOZXh0ID0gdGhpcy5mb3VuZE1heFJvdyAmJiB0aGlzLmN1cnJlbnRQYWdlID09PSAodGhpcy50b3RhbFBhZ2VzIC0gMSk7XHJcbiAgICB0aGlzLmJ0TmV4dC5kaXNhYmxlZCA9IGRpc2FibGVOZXh0O1xyXG5cclxuICAgIHZhciBkaXNhYmxlTGFzdCA9ICF0aGlzLmZvdW5kTWF4Um93IHx8IHRoaXMuY3VycmVudFBhZ2UgPT09ICh0aGlzLnRvdGFsUGFnZXMgLSAxKTtcclxuICAgIHRoaXMuYnRMYXN0LmRpc2FibGVkID0gZGlzYWJsZUxhc3Q7XHJcbn07XHJcblxyXG5QYWdpbmF0aW9uQ29udHJvbGxlci5wcm90b3R5cGUucG9wdWxhdGVQYW5lbCA9IGZ1bmN0aW9uKGVQYWdpbmdQYW5lbCkge1xyXG5cclxuICAgIGVQYWdpbmdQYW5lbC5pbm5lckhUTUwgPSBURU1QTEFURTtcclxuXHJcbiAgICB0aGlzLmJ0TmV4dCA9IGVQYWdpbmdQYW5lbC5xdWVyeVNlbGVjdG9yKCcjYnROZXh0Jyk7XHJcbiAgICB0aGlzLmJ0UHJldmlvdXMgPSBlUGFnaW5nUGFuZWwucXVlcnlTZWxlY3RvcignI2J0UHJldmlvdXMnKTtcclxuICAgIHRoaXMuYnRGaXJzdCA9IGVQYWdpbmdQYW5lbC5xdWVyeVNlbGVjdG9yKCcjYnRGaXJzdCcpO1xyXG4gICAgdGhpcy5idExhc3QgPSBlUGFnaW5nUGFuZWwucXVlcnlTZWxlY3RvcignI2J0TGFzdCcpO1xyXG4gICAgdGhpcy5sYkN1cnJlbnQgPSBlUGFnaW5nUGFuZWwucXVlcnlTZWxlY3RvcignI2N1cnJlbnQnKTtcclxuICAgIHRoaXMubGJUb3RhbCA9IGVQYWdpbmdQYW5lbC5xdWVyeVNlbGVjdG9yKCcjdG90YWwnKTtcclxuXHJcbiAgICB0aGlzLmxiUmVjb3JkQ291bnQgPSBlUGFnaW5nUGFuZWwucXVlcnlTZWxlY3RvcignI3JlY29yZENvdW50Jyk7XHJcbiAgICB0aGlzLmxiRmlyc3RSb3dPblBhZ2UgPSBlUGFnaW5nUGFuZWwucXVlcnlTZWxlY3RvcignI2ZpcnN0Um93T25QYWdlJyk7XHJcbiAgICB0aGlzLmxiTGFzdFJvd09uUGFnZSA9IGVQYWdpbmdQYW5lbC5xdWVyeVNlbGVjdG9yKCcjbGFzdFJvd09uUGFnZScpO1xyXG4gICAgdGhpcy5lUGFnZVJvd1N1bW1hcnlQYW5lbCA9IGVQYWdpbmdQYW5lbC5xdWVyeVNlbGVjdG9yKCcjcGFnZVJvd1N1bW1hcnlQYW5lbCcpO1xyXG5cclxuICAgIHZhciB0aGF0ID0gdGhpcztcclxuXHJcbiAgICB0aGlzLmJ0TmV4dC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIHRoYXQub25CdE5leHQoKTtcclxuICAgIH0pO1xyXG5cclxuICAgIHRoaXMuYnRQcmV2aW91cy5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIHRoYXQub25CdFByZXZpb3VzKCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICB0aGlzLmJ0Rmlyc3QuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCBmdW5jdGlvbigpIHtcclxuICAgICAgICB0aGF0Lm9uQnRGaXJzdCgpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgdGhpcy5idExhc3QuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCBmdW5jdGlvbigpIHtcclxuICAgICAgICB0aGF0Lm9uQnRMYXN0KCk7XHJcbiAgICB9KTtcclxufTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gUGFnaW5hdGlvbkNvbnRyb2xsZXI7XHJcbiIsInZhciBjb25zdGFudHMgPSByZXF1aXJlKCcuL2NvbnN0YW50cycpO1xyXG52YXIgU3ZnRmFjdG9yeSA9IHJlcXVpcmUoJy4vc3ZnRmFjdG9yeScpO1xyXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzJyk7XHJcblxyXG52YXIgc3ZnRmFjdG9yeSA9IG5ldyBTdmdGYWN0b3J5KCk7XHJcblxyXG52YXIgVEFCX0tFWSA9IDk7XHJcbnZhciBFTlRFUl9LRVkgPSAxMztcclxuXHJcbmZ1bmN0aW9uIFJvd1JlbmRlcmVyKCkge31cclxuXHJcblJvd1JlbmRlcmVyLnByb3RvdHlwZS5pbml0ID0gZnVuY3Rpb24oZ3JpZE9wdGlvbnMsIGNvbHVtbk1vZGVsLCBncmlkT3B0aW9uc1dyYXBwZXIsIGVHcmlkLFxyXG4gICAgYW5ndWxhckdyaWQsIHNlbGVjdGlvblJlbmRlcmVyRmFjdG9yeSwgJGNvbXBpbGUsICRzY29wZSxcclxuICAgIHNlbGVjdGlvbkNvbnRyb2xsZXIpIHtcclxuICAgIHRoaXMuZ3JpZE9wdGlvbnMgPSBncmlkT3B0aW9ucztcclxuICAgIHRoaXMuY29sdW1uTW9kZWwgPSBjb2x1bW5Nb2RlbDtcclxuICAgIHRoaXMuZ3JpZE9wdGlvbnNXcmFwcGVyID0gZ3JpZE9wdGlvbnNXcmFwcGVyO1xyXG4gICAgdGhpcy5hbmd1bGFyR3JpZCA9IGFuZ3VsYXJHcmlkO1xyXG4gICAgdGhpcy5zZWxlY3Rpb25SZW5kZXJlckZhY3RvcnkgPSBzZWxlY3Rpb25SZW5kZXJlckZhY3Rvcnk7XHJcbiAgICB0aGlzLmZpbmRBbGxFbGVtZW50cyhlR3JpZCk7XHJcbiAgICB0aGlzLiRjb21waWxlID0gJGNvbXBpbGU7XHJcbiAgICB0aGlzLiRzY29wZSA9ICRzY29wZTtcclxuICAgIHRoaXMuc2VsZWN0aW9uQ29udHJvbGxlciA9IHNlbGVjdGlvbkNvbnRyb2xsZXI7XHJcblxyXG4gICAgLy8gbWFwIG9mIHJvdyBpZHMgdG8gcm93IG9iamVjdHMuIGtlZXBzIHRyYWNrIG9mIHdoaWNoIGVsZW1lbnRzXHJcbiAgICAvLyBhcmUgcmVuZGVyZWQgZm9yIHdoaWNoIHJvd3MgaW4gdGhlIGRvbS4gZWFjaCByb3cgb2JqZWN0IGhhczpcclxuICAgIC8vIFtzY29wZSwgYm9keVJvdywgcGlubmVkUm93LCByb3dEYXRhXVxyXG4gICAgdGhpcy5yZW5kZXJlZFJvd3MgPSB7fTtcclxuXHJcbiAgICB0aGlzLnJlbmRlcmVkUm93U3RhcnRFZGl0aW5nTGlzdGVuZXJzID0ge307XHJcblxyXG4gICAgdGhpcy5lZGl0aW5nQ2VsbCA9IGZhbHNlOyAvL2dldHMgc2V0IHRvIHRydWUgd2hlbiBlZGl0aW5nIGEgY2VsbFxyXG59O1xyXG5cclxuUm93UmVuZGVyZXIucHJvdG90eXBlLnNldFJvd01vZGVsID0gZnVuY3Rpb24ocm93TW9kZWwpIHtcclxuICAgIHRoaXMucm93TW9kZWwgPSByb3dNb2RlbDtcclxufTtcclxuXHJcblJvd1JlbmRlcmVyLnByb3RvdHlwZS5zZXRNYWluUm93V2lkdGhzID0gZnVuY3Rpb24oKSB7XHJcbiAgICB2YXIgbWFpblJvd1dpZHRoID0gdGhpcy5jb2x1bW5Nb2RlbC5nZXRCb2R5Q29udGFpbmVyV2lkdGgoKSArIFwicHhcIjtcclxuXHJcbiAgICB2YXIgdW5waW5uZWRSb3dzID0gdGhpcy5lQm9keUNvbnRhaW5lci5xdWVyeVNlbGVjdG9yQWxsKFwiLmFnLXJvd1wiKTtcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdW5waW5uZWRSb3dzLmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgdW5waW5uZWRSb3dzW2ldLnN0eWxlLndpZHRoID0gbWFpblJvd1dpZHRoO1xyXG4gICAgfVxyXG59O1xyXG5cclxuUm93UmVuZGVyZXIucHJvdG90eXBlLmZpbmRBbGxFbGVtZW50cyA9IGZ1bmN0aW9uKGVHcmlkKSB7XHJcbiAgICBpZiAodGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuaXNEb250VXNlU2Nyb2xscygpKSB7XHJcbiAgICAgICAgdGhpcy5lQm9keUNvbnRhaW5lciA9IGVHcmlkLnF1ZXJ5U2VsZWN0b3IoXCIuYWctYm9keS1jb250YWluZXJcIik7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHRoaXMuZUJvZHlDb250YWluZXIgPSBlR3JpZC5xdWVyeVNlbGVjdG9yKFwiLmFnLWJvZHktY29udGFpbmVyXCIpO1xyXG4gICAgICAgIHRoaXMuZUJvZHlWaWV3cG9ydCA9IGVHcmlkLnF1ZXJ5U2VsZWN0b3IoXCIuYWctYm9keS12aWV3cG9ydFwiKTtcclxuICAgICAgICB0aGlzLmVQaW5uZWRDb2xzQ29udGFpbmVyID0gZUdyaWQucXVlcnlTZWxlY3RvcihcIi5hZy1waW5uZWQtY29scy1jb250YWluZXJcIik7XHJcbiAgICB9XHJcbn07XHJcblxyXG5Sb3dSZW5kZXJlci5wcm90b3R5cGUucmVmcmVzaFZpZXcgPSBmdW5jdGlvbigpIHtcclxuICAgIGlmICghdGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuaXNEb250VXNlU2Nyb2xscygpKSB7XHJcbiAgICAgICAgdmFyIHJvd0NvdW50ID0gdGhpcy5yb3dNb2RlbC5nZXRWaXJ0dWFsUm93Q291bnQoKTtcclxuICAgICAgICB2YXIgY29udGFpbmVySGVpZ2h0ID0gdGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuZ2V0Um93SGVpZ2h0KCkgKiByb3dDb3VudDtcclxuICAgICAgICB0aGlzLmVCb2R5Q29udGFpbmVyLnN0eWxlLmhlaWdodCA9IGNvbnRhaW5lckhlaWdodCArIFwicHhcIjtcclxuICAgICAgICB0aGlzLmVQaW5uZWRDb2xzQ29udGFpbmVyLnN0eWxlLmhlaWdodCA9IGNvbnRhaW5lckhlaWdodCArIFwicHhcIjtcclxuICAgIH1cclxuXHJcbiAgICB0aGlzLnJlZnJlc2hBbGxWaXJ0dWFsUm93cygpO1xyXG59O1xyXG5cclxuUm93UmVuZGVyZXIucHJvdG90eXBlLnJvd0RhdGFDaGFuZ2VkID0gZnVuY3Rpb24ocm93cykge1xyXG4gICAgLy8gd2Ugb25seSBuZWVkIHRvIGJlIHdvcnJpZWQgYWJvdXQgcmVuZGVyZWQgcm93cywgYXMgdGhpcyBtZXRob2QgaXNcclxuICAgIC8vIGNhbGxlZCB0byB3aGF0cyByZW5kZXJlZC4gaWYgdGhlIHJvdyBpc24ndCByZW5kZXJlZCwgd2UgZG9uJ3QgY2FyZVxyXG4gICAgdmFyIGluZGV4ZXNUb1JlbW92ZSA9IFtdO1xyXG4gICAgdmFyIHJlbmRlcmVkUm93cyA9IHRoaXMucmVuZGVyZWRSb3dzO1xyXG4gICAgT2JqZWN0LmtleXMocmVuZGVyZWRSb3dzKS5mb3JFYWNoKGZ1bmN0aW9uKGtleSkge1xyXG4gICAgICAgIHZhciByZW5kZXJlZFJvdyA9IHJlbmRlcmVkUm93c1trZXldO1xyXG4gICAgICAgIC8vIHNlZSBpZiB0aGUgcmVuZGVyZWQgcm93IGlzIGluIHRoZSBsaXN0IG9mIHJvd3Mgd2UgaGF2ZSB0byB1cGRhdGVcclxuICAgICAgICB2YXIgcm93TmVlZHNVcGRhdGluZyA9IHJvd3MuaW5kZXhPZihyZW5kZXJlZFJvdy5ub2RlLmRhdGEpID49IDA7XHJcbiAgICAgICAgaWYgKHJvd05lZWRzVXBkYXRpbmcpIHtcclxuICAgICAgICAgICAgaW5kZXhlc1RvUmVtb3ZlLnB1c2goa2V5KTtcclxuICAgICAgICB9XHJcbiAgICB9KTtcclxuICAgIC8vIHJlbW92ZSB0aGUgcm93c1xyXG4gICAgdGhpcy5yZW1vdmVWaXJ0dWFsUm93cyhpbmRleGVzVG9SZW1vdmUpO1xyXG4gICAgLy8gYWRkIGRyYXcgdGhlbSBhZ2FpblxyXG4gICAgdGhpcy5kcmF3VmlydHVhbFJvd3MoKTtcclxufTtcclxuXHJcblJvd1JlbmRlcmVyLnByb3RvdHlwZS5yZWZyZXNoQWxsVmlydHVhbFJvd3MgPSBmdW5jdGlvbigpIHtcclxuICAgIC8vIHJlbW92ZSBhbGwgY3VycmVudCB2aXJ0dWFsIHJvd3MsIGFzIHRoZXkgaGF2ZSBvbGQgZGF0YVxyXG4gICAgdmFyIHJvd3NUb1JlbW92ZSA9IE9iamVjdC5rZXlzKHRoaXMucmVuZGVyZWRSb3dzKTtcclxuICAgIHRoaXMucmVtb3ZlVmlydHVhbFJvd3Mocm93c1RvUmVtb3ZlKTtcclxuXHJcbiAgICAvLyBhZGQgaW4gbmV3IHJvd3NcclxuICAgIHRoaXMuZHJhd1ZpcnR1YWxSb3dzKCk7XHJcbn07XHJcblxyXG4vLyBwdWJsaWMgLSByZW1vdmVzIHRoZSBncm91cCByb3dzIGFuZCB0aGVuIHJlZHJhd3MgdGhlbSBhZ2FpblxyXG5Sb3dSZW5kZXJlci5wcm90b3R5cGUucmVmcmVzaEdyb3VwUm93cyA9IGZ1bmN0aW9uKCkge1xyXG4gICAgLy8gZmluZCBhbGwgdGhlIGdyb3VwIHJvd3NcclxuICAgIHZhciByb3dzVG9SZW1vdmUgPSBbXTtcclxuICAgIHZhciB0aGF0ID0gdGhpcztcclxuICAgIE9iamVjdC5rZXlzKHRoaXMucmVuZGVyZWRSb3dzKS5mb3JFYWNoKGZ1bmN0aW9uKGtleSkge1xyXG4gICAgICAgIHZhciByZW5kZXJlZFJvdyA9IHRoYXQucmVuZGVyZWRSb3dzW2tleV07XHJcbiAgICAgICAgdmFyIG5vZGUgPSByZW5kZXJlZFJvdy5ub2RlO1xyXG4gICAgICAgIGlmIChub2RlLmdyb3VwKSB7XHJcbiAgICAgICAgICAgIHJvd3NUb1JlbW92ZS5wdXNoKGtleSk7XHJcbiAgICAgICAgfVxyXG4gICAgfSk7XHJcbiAgICAvLyByZW1vdmUgdGhlIHJvd3NcclxuICAgIHRoaXMucmVtb3ZlVmlydHVhbFJvd3Mocm93c1RvUmVtb3ZlKTtcclxuICAgIC8vIGFuZCBkcmF3IHRoZW0gYmFjayBhZ2FpblxyXG4gICAgdGhpcy5lbnN1cmVSb3dzUmVuZGVyZWQoKTtcclxufTtcclxuXHJcbi8vIHRha2VzIGFycmF5IG9mIHJvdyBpbmRleGVzXHJcblJvd1JlbmRlcmVyLnByb3RvdHlwZS5yZW1vdmVWaXJ0dWFsUm93cyA9IGZ1bmN0aW9uKHJvd3NUb1JlbW92ZSkge1xyXG4gICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgcm93c1RvUmVtb3ZlLmZvckVhY2goZnVuY3Rpb24oaW5kZXhUb1JlbW92ZSkge1xyXG4gICAgICAgIHRoYXQucmVtb3ZlVmlydHVhbFJvdyhpbmRleFRvUmVtb3ZlKTtcclxuICAgIH0pO1xyXG59O1xyXG5cclxuUm93UmVuZGVyZXIucHJvdG90eXBlLnJlbW92ZVZpcnR1YWxSb3cgPSBmdW5jdGlvbihpbmRleFRvUmVtb3ZlKSB7XHJcbiAgICB2YXIgcmVuZGVyZWRSb3cgPSB0aGlzLnJlbmRlcmVkUm93c1tpbmRleFRvUmVtb3ZlXTtcclxuICAgIGlmIChyZW5kZXJlZFJvdy5waW5uZWRFbGVtZW50ICYmIHRoaXMuZVBpbm5lZENvbHNDb250YWluZXIpIHtcclxuICAgICAgICB0aGlzLmVQaW5uZWRDb2xzQ29udGFpbmVyLnJlbW92ZUNoaWxkKHJlbmRlcmVkUm93LnBpbm5lZEVsZW1lbnQpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChyZW5kZXJlZFJvdy5ib2R5RWxlbWVudCkge1xyXG4gICAgICAgIHRoaXMuZUJvZHlDb250YWluZXIucmVtb3ZlQ2hpbGQocmVuZGVyZWRSb3cuYm9keUVsZW1lbnQpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChyZW5kZXJlZFJvdy5zY29wZSkge1xyXG4gICAgICAgIHJlbmRlcmVkUm93LnNjb3BlLiRkZXN0cm95KCk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHRoaXMuZ3JpZE9wdGlvbnNXcmFwcGVyLmdldFZpcnR1YWxSb3dSZW1vdmVkKCkpIHtcclxuICAgICAgICB0aGlzLmdyaWRPcHRpb25zV3JhcHBlci5nZXRWaXJ0dWFsUm93UmVtb3ZlZCgpKHJlbmRlcmVkUm93LmRhdGEsIGluZGV4VG9SZW1vdmUpO1xyXG4gICAgfVxyXG4gICAgdGhpcy5hbmd1bGFyR3JpZC5vblZpcnR1YWxSb3dSZW1vdmVkKGluZGV4VG9SZW1vdmUpO1xyXG5cclxuICAgIGRlbGV0ZSB0aGlzLnJlbmRlcmVkUm93c1tpbmRleFRvUmVtb3ZlXTtcclxuICAgIGRlbGV0ZSB0aGlzLnJlbmRlcmVkUm93U3RhcnRFZGl0aW5nTGlzdGVuZXJzW2luZGV4VG9SZW1vdmVdO1xyXG59O1xyXG5cclxuUm93UmVuZGVyZXIucHJvdG90eXBlLmRyYXdWaXJ0dWFsUm93cyA9IGZ1bmN0aW9uKCkge1xyXG4gICAgdmFyIGZpcnN0O1xyXG4gICAgdmFyIGxhc3Q7XHJcblxyXG4gICAgdmFyIHJvd0NvdW50ID0gdGhpcy5yb3dNb2RlbC5nZXRWaXJ0dWFsUm93Q291bnQoKTtcclxuXHJcbiAgICBpZiAodGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuaXNEb250VXNlU2Nyb2xscygpKSB7XHJcbiAgICAgICAgZmlyc3QgPSAwO1xyXG4gICAgICAgIGxhc3QgPSByb3dDb3VudDtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdmFyIHRvcFBpeGVsID0gdGhpcy5lQm9keVZpZXdwb3J0LnNjcm9sbFRvcDtcclxuICAgICAgICB2YXIgYm90dG9tUGl4ZWwgPSB0b3BQaXhlbCArIHRoaXMuZUJvZHlWaWV3cG9ydC5vZmZzZXRIZWlnaHQ7XHJcblxyXG4gICAgICAgIGZpcnN0ID0gTWF0aC5mbG9vcih0b3BQaXhlbCAvIHRoaXMuZ3JpZE9wdGlvbnNXcmFwcGVyLmdldFJvd0hlaWdodCgpKTtcclxuICAgICAgICBsYXN0ID0gTWF0aC5mbG9vcihib3R0b21QaXhlbCAvIHRoaXMuZ3JpZE9wdGlvbnNXcmFwcGVyLmdldFJvd0hlaWdodCgpKTtcclxuXHJcbiAgICAgICAgLy9hZGQgaW4gYnVmZmVyXHJcbiAgICAgICAgZmlyc3QgPSBmaXJzdCAtIGNvbnN0YW50cy5ST1dfQlVGRkVSX1NJWkU7XHJcbiAgICAgICAgbGFzdCA9IGxhc3QgKyBjb25zdGFudHMuUk9XX0JVRkZFUl9TSVpFO1xyXG5cclxuICAgICAgICAvLyBhZGp1c3QsIGluIGNhc2UgYnVmZmVyIGV4dGVuZGVkIGFjdHVhbCBzaXplXHJcbiAgICAgICAgaWYgKGZpcnN0IDwgMCkge1xyXG4gICAgICAgICAgICBmaXJzdCA9IDA7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChsYXN0ID4gcm93Q291bnQgLSAxKSB7XHJcbiAgICAgICAgICAgIGxhc3QgPSByb3dDb3VudCAtIDE7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHRoaXMuZmlyc3RWaXJ0dWFsUmVuZGVyZWRSb3cgPSBmaXJzdDtcclxuICAgIHRoaXMubGFzdFZpcnR1YWxSZW5kZXJlZFJvdyA9IGxhc3Q7XHJcblxyXG4gICAgdGhpcy5lbnN1cmVSb3dzUmVuZGVyZWQoKTtcclxufTtcclxuXHJcblJvd1JlbmRlcmVyLnByb3RvdHlwZS5pc0luZGV4UmVuZGVyZWQgPSBmdW5jdGlvbihpbmRleCkge1xyXG4gICAgcmV0dXJuIGluZGV4ID49IHRoaXMuZmlyc3RWaXJ0dWFsUmVuZGVyZWRSb3cgJiYgaW5kZXggPD0gdGhpcy5sYXN0VmlydHVhbFJlbmRlcmVkUm93O1xyXG59O1xyXG5cclxuUm93UmVuZGVyZXIucHJvdG90eXBlLmdldEZpcnN0VmlydHVhbFJlbmRlcmVkUm93ID0gZnVuY3Rpb24oKSB7XHJcbiAgICByZXR1cm4gdGhpcy5maXJzdFZpcnR1YWxSZW5kZXJlZFJvdztcclxufTtcclxuXHJcblJvd1JlbmRlcmVyLnByb3RvdHlwZS5nZXRMYXN0VmlydHVhbFJlbmRlcmVkUm93ID0gZnVuY3Rpb24oKSB7XHJcbiAgICByZXR1cm4gdGhpcy5sYXN0VmlydHVhbFJlbmRlcmVkUm93O1xyXG59O1xyXG5cclxuUm93UmVuZGVyZXIucHJvdG90eXBlLmVuc3VyZVJvd3NSZW5kZXJlZCA9IGZ1bmN0aW9uKCkge1xyXG5cclxuICAgIHZhciBtYWluUm93V2lkdGggPSB0aGlzLmNvbHVtbk1vZGVsLmdldEJvZHlDb250YWluZXJXaWR0aCgpO1xyXG4gICAgdmFyIHRoYXQgPSB0aGlzO1xyXG5cclxuICAgIC8vYXQgdGhlIGVuZCwgdGhpcyBhcnJheSB3aWxsIGNvbnRhaW4gdGhlIGl0ZW1zIHdlIG5lZWQgdG8gcmVtb3ZlXHJcbiAgICB2YXIgcm93c1RvUmVtb3ZlID0gT2JqZWN0LmtleXModGhpcy5yZW5kZXJlZFJvd3MpO1xyXG5cclxuICAgIC8vYWRkIGluIG5ldyByb3dzXHJcbiAgICBmb3IgKHZhciByb3dJbmRleCA9IHRoaXMuZmlyc3RWaXJ0dWFsUmVuZGVyZWRSb3c7IHJvd0luZGV4IDw9IHRoaXMubGFzdFZpcnR1YWxSZW5kZXJlZFJvdzsgcm93SW5kZXgrKykge1xyXG4gICAgICAgIC8vIHNlZSBpZiBpdGVtIGFscmVhZHkgdGhlcmUsIGFuZCBpZiB5ZXMsIHRha2UgaXQgb3V0IG9mIHRoZSAndG8gcmVtb3ZlJyBhcnJheVxyXG4gICAgICAgIGlmIChyb3dzVG9SZW1vdmUuaW5kZXhPZihyb3dJbmRleC50b1N0cmluZygpKSA+PSAwKSB7XHJcbiAgICAgICAgICAgIHJvd3NUb1JlbW92ZS5zcGxpY2Uocm93c1RvUmVtb3ZlLmluZGV4T2Yocm93SW5kZXgudG9TdHJpbmcoKSksIDEpO1xyXG4gICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgLy8gY2hlY2sgdGhpcyByb3cgYWN0dWFsbHkgZXhpc3RzIChpbiBjYXNlIG92ZXJmbG93IGJ1ZmZlciB3aW5kb3cgZXhjZWVkcyByZWFsIGRhdGEpXHJcbiAgICAgICAgdmFyIG5vZGUgPSB0aGlzLnJvd01vZGVsLmdldFZpcnR1YWxSb3cocm93SW5kZXgpO1xyXG4gICAgICAgIGlmIChub2RlKSB7XHJcbiAgICAgICAgICAgIHRoYXQuaW5zZXJ0Um93KG5vZGUsIHJvd0luZGV4LCBtYWluUm93V2lkdGgpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvL2F0IHRoaXMgcG9pbnQsIGV2ZXJ5dGhpbmcgaW4gb3VyICdyb3dzVG9SZW1vdmUnIC4gLiAuXHJcbiAgICB0aGlzLnJlbW92ZVZpcnR1YWxSb3dzKHJvd3NUb1JlbW92ZSk7XHJcblxyXG4gICAgLy9pZiB3ZSBhcmUgZG9pbmcgYW5ndWxhciBjb21waWxpbmcsIHRoZW4gZG8gZGlnZXN0IHRoZSBzY29wZSBoZXJlXHJcbiAgICBpZiAodGhpcy5ncmlkT3B0aW9ucy5hbmd1bGFyQ29tcGlsZVJvd3MpIHtcclxuICAgICAgICAvLyB3ZSBkbyBpdCBpbiBhIHRpbWVvdXQsIGluIGNhc2Ugd2UgYXJlIGFscmVhZHkgaW4gYW4gYXBwbHlcclxuICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICB0aGF0LiRzY29wZS4kYXBwbHkoKTtcclxuICAgICAgICB9LCAwKTtcclxuICAgIH1cclxufTtcclxuXHJcblJvd1JlbmRlcmVyLnByb3RvdHlwZS5pbnNlcnRSb3cgPSBmdW5jdGlvbihub2RlLCByb3dJbmRleCwgbWFpblJvd1dpZHRoKSB7XHJcbiAgICAvL2lmIG5vIGNvbHMsIGRvbid0IGRyYXcgcm93XHJcbiAgICBpZiAoIXRoaXMuZ3JpZE9wdGlvbnNXcmFwcGVyLmlzQ29sdW1EZWZzUHJlc2VudCgpKSB7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIC8vdmFyIHJvd0RhdGEgPSBub2RlLnJvd0RhdGE7XHJcbiAgICB2YXIgcm93SXNBR3JvdXAgPSBub2RlLmdyb3VwO1xyXG4gICAgdmFyIHJvd0lzQUZvb3RlciA9IG5vZGUuZm9vdGVyO1xyXG5cclxuICAgIHZhciBlUGlubmVkUm93ID0gdGhpcy5jcmVhdGVSb3dDb250YWluZXIocm93SW5kZXgsIG5vZGUsIHJvd0lzQUdyb3VwKTtcclxuICAgIHZhciBlTWFpblJvdyA9IHRoaXMuY3JlYXRlUm93Q29udGFpbmVyKHJvd0luZGV4LCBub2RlLCByb3dJc0FHcm91cCk7XHJcbiAgICB2YXIgX3RoaXMgPSB0aGlzO1xyXG5cclxuICAgIGVNYWluUm93LnN0eWxlLndpZHRoID0gbWFpblJvd1dpZHRoICsgXCJweFwiO1xyXG5cclxuICAgIC8vIHRyeSBjb21waWxpbmcgYXMgd2UgaW5zZXJ0IHJvd3NcclxuICAgIHZhciBuZXdDaGlsZFNjb3BlID0gdGhpcy5jcmVhdGVDaGlsZFNjb3BlT3JOdWxsKG5vZGUuZGF0YSk7XHJcblxyXG4gICAgdmFyIHJlbmRlcmVkUm93ID0ge1xyXG4gICAgICAgIHNjb3BlOiBuZXdDaGlsZFNjb3BlLFxyXG4gICAgICAgIG5vZGU6IG5vZGUsXHJcbiAgICAgICAgcm93SW5kZXg6IHJvd0luZGV4XHJcbiAgICB9O1xyXG4gICAgdGhpcy5yZW5kZXJlZFJvd3Nbcm93SW5kZXhdID0gcmVuZGVyZWRSb3c7XHJcbiAgICB0aGlzLnJlbmRlcmVkUm93U3RhcnRFZGl0aW5nTGlzdGVuZXJzW3Jvd0luZGV4XSA9IHt9O1xyXG5cclxuICAgIC8vIGlmIGdyb3VwIGl0ZW0sIGluc2VydCB0aGUgZmlyc3Qgcm93XHJcbiAgICB2YXIgY29sdW1ucyA9IHRoaXMuY29sdW1uTW9kZWwuZ2V0VmlzaWJsZUNvbHVtbnMoKTtcclxuICAgIGlmIChyb3dJc0FHcm91cCkge1xyXG4gICAgICAgIHZhciBmaXJzdENvbHVtbiA9IGNvbHVtbnNbMF07XHJcbiAgICAgICAgdmFyIGdyb3VwSGVhZGVyVGFrZXNFbnRpcmVSb3cgPSB0aGlzLmdyaWRPcHRpb25zV3JhcHBlci5pc0dyb3VwVXNlRW50aXJlUm93KCk7XHJcblxyXG4gICAgICAgIHZhciBlR3JvdXBSb3cgPSBfdGhpcy5jcmVhdGVHcm91cEVsZW1lbnQobm9kZSwgZmlyc3RDb2x1bW4sIGdyb3VwSGVhZGVyVGFrZXNFbnRpcmVSb3csIGZhbHNlLCByb3dJbmRleCwgcm93SXNBRm9vdGVyKTtcclxuICAgICAgICBpZiAoZmlyc3RDb2x1bW4ucGlubmVkKSB7XHJcbiAgICAgICAgICAgIGVQaW5uZWRSb3cuYXBwZW5kQ2hpbGQoZUdyb3VwUm93KTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBlTWFpblJvdy5hcHBlbmRDaGlsZChlR3JvdXBSb3cpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKGZpcnN0Q29sdW1uLnBpbm5lZCAmJiBncm91cEhlYWRlclRha2VzRW50aXJlUm93KSB7XHJcbiAgICAgICAgICAgIHZhciBlR3JvdXBSb3dQYWRkaW5nID0gX3RoaXMuY3JlYXRlR3JvdXBFbGVtZW50KG5vZGUsIGZpcnN0Q29sdW1uLCBncm91cEhlYWRlclRha2VzRW50aXJlUm93LCB0cnVlLCByb3dJbmRleCwgcm93SXNBRm9vdGVyKTtcclxuICAgICAgICAgICAgZU1haW5Sb3cuYXBwZW5kQ2hpbGQoZUdyb3VwUm93UGFkZGluZyk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBpZiAoIWdyb3VwSGVhZGVyVGFrZXNFbnRpcmVSb3cpIHtcclxuXHJcbiAgICAgICAgICAgIC8vIGRyYXcgaW4gY2VsbHMgZm9yIHRoZSByZXN0IG9mIHRoZSByb3cuXHJcbiAgICAgICAgICAgIC8vIGlmIGdyb3VwIGlzIGEgZm9vdGVyLCBhbHdheXMgc2hvdyB0aGUgZGF0YS5cclxuICAgICAgICAgICAgLy8gaWYgZ3JvdXAgaXMgYSBoZWFkZXIsIG9ubHkgc2hvdyBkYXRhIGlmIG5vdCBleHBhbmRlZFxyXG4gICAgICAgICAgICB2YXIgZ3JvdXBEYXRhO1xyXG4gICAgICAgICAgICBpZiAobm9kZS5mb290ZXIpIHtcclxuICAgICAgICAgICAgICAgIGdyb3VwRGF0YSA9IG5vZGUuZGF0YTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIC8vIHdlIHNob3cgZGF0YSBpbiBmb290ZXIgb25seVxyXG4gICAgICAgICAgICAgICAgdmFyIGZvb3RlcnNFbmFibGVkID0gdGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuaXNHcm91cEluY2x1ZGVGb290ZXIoKTtcclxuICAgICAgICAgICAgICAgIGdyb3VwRGF0YSA9IChub2RlLmV4cGFuZGVkICYmIGZvb3RlcnNFbmFibGVkKSA/IHVuZGVmaW5lZCA6IG5vZGUuZGF0YTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBjb2x1bW5zLmZvckVhY2goZnVuY3Rpb24oY29sdW1uLCBjb2xJbmRleCkge1xyXG4gICAgICAgICAgICAgICAgaWYgKGNvbEluZGV4ID09IDApIHsgLy9za2lwIGZpcnN0IGNvbCwgYXMgdGhpcyBpcyB0aGUgZ3JvdXAgY29sIHdlIGFscmVhZHkgaW5zZXJ0ZWRcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB2YXIgdmFsdWUgPSBncm91cERhdGEgPyBncm91cERhdGFbY29sdW1uLmNvbERlZi5maWVsZF0gOiB1bmRlZmluZWQ7XHJcbiAgICAgICAgICAgICAgICBfdGhpcy5jcmVhdGVDZWxsRnJvbUNvbERlZihmYWxzZSwgY29sdW1uLCB2YWx1ZSwgbm9kZSwgcm93SW5kZXgsIGVNYWluUm93LCBlUGlubmVkUm93LCBuZXdDaGlsZFNjb3BlKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgY29sdW1ucy5mb3JFYWNoKGZ1bmN0aW9uKGNvbHVtbiwgaW5kZXgpIHtcclxuICAgICAgICAgICAgdmFyIGZpcnN0Q29sID0gaW5kZXggPT09IDA7XHJcbiAgICAgICAgICAgIF90aGlzLmNyZWF0ZUNlbGxGcm9tQ29sRGVmKGZpcnN0Q29sLCBjb2x1bW4sIG5vZGUuZGF0YVtjb2x1bW4uY29sRGVmLmZpZWxkXSwgbm9kZSwgcm93SW5kZXgsIGVNYWluUm93LCBlUGlubmVkUm93LCBuZXdDaGlsZFNjb3BlKTtcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICAvL3RyeSBjb21waWxpbmcgYXMgd2UgaW5zZXJ0IHJvd3NcclxuICAgIHJlbmRlcmVkUm93LnBpbm5lZEVsZW1lbnQgPSB0aGlzLmNvbXBpbGVBbmRBZGQodGhpcy5lUGlubmVkQ29sc0NvbnRhaW5lciwgcm93SW5kZXgsIGVQaW5uZWRSb3csIG5ld0NoaWxkU2NvcGUpO1xyXG4gICAgcmVuZGVyZWRSb3cuYm9keUVsZW1lbnQgPSB0aGlzLmNvbXBpbGVBbmRBZGQodGhpcy5lQm9keUNvbnRhaW5lciwgcm93SW5kZXgsIGVNYWluUm93LCBuZXdDaGlsZFNjb3BlKTtcclxufTtcclxuXHJcblJvd1JlbmRlcmVyLnByb3RvdHlwZS5jcmVhdGVDaGlsZFNjb3BlT3JOdWxsID0gZnVuY3Rpb24oZGF0YSkge1xyXG4gICAgaWYgKHRoaXMuZ3JpZE9wdGlvbnNXcmFwcGVyLmlzQW5ndWxhckNvbXBpbGVSb3dzKCkpIHtcclxuICAgICAgICB2YXIgbmV3Q2hpbGRTY29wZSA9IHRoaXMuJHNjb3BlLiRuZXcoKTtcclxuICAgICAgICBuZXdDaGlsZFNjb3BlLmRhdGEgPSBkYXRhO1xyXG4gICAgICAgIHJldHVybiBuZXdDaGlsZFNjb3BlO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxufTtcclxuXHJcblJvd1JlbmRlcmVyLnByb3RvdHlwZS5jb21waWxlQW5kQWRkID0gZnVuY3Rpb24oY29udGFpbmVyLCByb3dJbmRleCwgZWxlbWVudCwgc2NvcGUpIHtcclxuICAgIGlmIChzY29wZSkge1xyXG4gICAgICAgIHZhciBlRWxlbWVudENvbXBpbGVkID0gdGhpcy4kY29tcGlsZShlbGVtZW50KShzY29wZSk7XHJcbiAgICAgICAgaWYgKGNvbnRhaW5lcikgeyAvLyBjaGVja2luZyBjb250YWluZXIsIGFzIGlmIG5vU2Nyb2xsLCBwaW5uZWQgY29udGFpbmVyIGlzIG1pc3NpbmdcclxuICAgICAgICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGVFbGVtZW50Q29tcGlsZWRbMF0pO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gZUVsZW1lbnRDb21waWxlZFswXTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgaWYgKGNvbnRhaW5lcikge1xyXG4gICAgICAgICAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQoZWxlbWVudCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBlbGVtZW50O1xyXG4gICAgfVxyXG59O1xyXG5cclxuUm93UmVuZGVyZXIucHJvdG90eXBlLmNyZWF0ZUNlbGxGcm9tQ29sRGVmID0gZnVuY3Rpb24oaXNGaXJzdENvbHVtbiwgY29sdW1uLCB2YWx1ZSwgbm9kZSwgcm93SW5kZXgsIGVNYWluUm93LCBlUGlubmVkUm93LCAkY2hpbGRTY29wZSkge1xyXG4gICAgdmFyIGVHcmlkQ2VsbCA9IHRoaXMuY3JlYXRlQ2VsbChpc0ZpcnN0Q29sdW1uLCBjb2x1bW4sIHZhbHVlLCBub2RlLCByb3dJbmRleCwgJGNoaWxkU2NvcGUpO1xyXG5cclxuICAgIGlmIChjb2x1bW4ucGlubmVkKSB7XHJcbiAgICAgICAgZVBpbm5lZFJvdy5hcHBlbmRDaGlsZChlR3JpZENlbGwpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICBlTWFpblJvdy5hcHBlbmRDaGlsZChlR3JpZENlbGwpO1xyXG4gICAgfVxyXG59O1xyXG5cclxuUm93UmVuZGVyZXIucHJvdG90eXBlLmFkZENsYXNzZXNUb1JvdyA9IGZ1bmN0aW9uKHJvd0luZGV4LCBub2RlLCBlUm93KSB7XHJcbiAgICB2YXIgY2xhc3Nlc0xpc3QgPSBbXCJhZy1yb3dcIl07XHJcbiAgICBjbGFzc2VzTGlzdC5wdXNoKHJvd0luZGV4ICUgMiA9PSAwID8gXCJhZy1yb3ctZXZlblwiIDogXCJhZy1yb3ctb2RkXCIpO1xyXG5cclxuICAgIGlmICh0aGlzLnNlbGVjdGlvbkNvbnRyb2xsZXIuaXNOb2RlU2VsZWN0ZWQobm9kZSkpIHtcclxuICAgICAgICBjbGFzc2VzTGlzdC5wdXNoKFwiYWctcm93LXNlbGVjdGVkXCIpO1xyXG4gICAgfVxyXG4gICAgaWYgKG5vZGUuZ3JvdXApIHtcclxuICAgICAgICAvLyBpZiBhIGdyb3VwLCBwdXQgdGhlIGxldmVsIG9mIHRoZSBncm91cCBpblxyXG4gICAgICAgIGNsYXNzZXNMaXN0LnB1c2goXCJhZy1yb3ctbGV2ZWwtXCIgKyBub2RlLmxldmVsKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgLy8gaWYgYSBsZWFmLCBhbmQgYSBwYXJlbnQgZXhpc3RzLCBwdXQgYSBsZXZlbCBvZiB0aGUgcGFyZW50LCBlbHNlIHB1dCBsZXZlbCBvZiAwIGZvciB0b3AgbGV2ZWwgaXRlbVxyXG4gICAgICAgIGlmIChub2RlLnBhcmVudCkge1xyXG4gICAgICAgICAgICBjbGFzc2VzTGlzdC5wdXNoKFwiYWctcm93LWxldmVsLVwiICsgKG5vZGUucGFyZW50LmxldmVsICsgMSkpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGNsYXNzZXNMaXN0LnB1c2goXCJhZy1yb3ctbGV2ZWwtMFwiKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBpZiAobm9kZS5ncm91cCkge1xyXG4gICAgICAgIGNsYXNzZXNMaXN0LnB1c2goXCJhZy1yb3ctZ3JvdXBcIik7XHJcbiAgICB9XHJcbiAgICBpZiAobm9kZS5ncm91cCAmJiAhbm9kZS5mb290ZXIgJiYgbm9kZS5leHBhbmRlZCkge1xyXG4gICAgICAgIGNsYXNzZXNMaXN0LnB1c2goXCJhZy1yb3ctZ3JvdXAtZXhwYW5kZWRcIik7XHJcbiAgICB9XHJcbiAgICBpZiAobm9kZS5ncm91cCAmJiAhbm9kZS5mb290ZXIgJiYgIW5vZGUuZXhwYW5kZWQpIHtcclxuICAgICAgICAvLyBvcHBvc2l0ZSBvZiBleHBhbmRlZCBpcyBjb250cmFjdGVkIGFjY29yZGluZyB0byB0aGUgaW50ZXJuZXQuXHJcbiAgICAgICAgY2xhc3Nlc0xpc3QucHVzaChcImFnLXJvdy1ncm91cC1jb250cmFjdGVkXCIpO1xyXG4gICAgfVxyXG4gICAgaWYgKG5vZGUuZ3JvdXAgJiYgbm9kZS5mb290ZXIpIHtcclxuICAgICAgICBjbGFzc2VzTGlzdC5wdXNoKFwiYWctcm93LWZvb3RlclwiKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBhZGQgaW4gZXh0cmEgY2xhc3NlcyBwcm92aWRlZCBieSB0aGUgY29uZmlnXHJcbiAgICBpZiAodGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuZ2V0Um93Q2xhc3MoKSkge1xyXG4gICAgICAgIHZhciBwYXJhbXMgPSB7XHJcbiAgICAgICAgICAgIG5vZGU6IG5vZGUsXHJcbiAgICAgICAgICAgIGRhdGE6IG5vZGUuZGF0YSxcclxuICAgICAgICAgICAgcm93SW5kZXg6IHJvd0luZGV4LFxyXG4gICAgICAgICAgICBjb250ZXh0OiB0aGlzLmdyaWRPcHRpb25zV3JhcHBlci5nZXRDb250ZXh0KCksXHJcbiAgICAgICAgICAgIGdyaWRPcHRpb25zOiB0aGlzLmdyaWRPcHRpb25zV3JhcHBlci5nZXRHcmlkT3B0aW9ucygpXHJcbiAgICAgICAgfTtcclxuICAgICAgICB2YXIgZXh0cmFSb3dDbGFzc2VzID0gdGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuZ2V0Um93Q2xhc3MoKShwYXJhbXMpO1xyXG4gICAgICAgIGlmIChleHRyYVJvd0NsYXNzZXMpIHtcclxuICAgICAgICAgICAgaWYgKHR5cGVvZiBleHRyYVJvd0NsYXNzZXMgPT09ICdzdHJpbmcnKSB7XHJcbiAgICAgICAgICAgICAgICBjbGFzc2VzTGlzdC5wdXNoKGV4dHJhUm93Q2xhc3Nlcyk7XHJcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoQXJyYXkuaXNBcnJheShleHRyYVJvd0NsYXNzZXMpKSB7XHJcbiAgICAgICAgICAgICAgICBleHRyYVJvd0NsYXNzZXMuZm9yRWFjaChmdW5jdGlvbihjbGFzc0l0ZW0pIHtcclxuICAgICAgICAgICAgICAgICAgICBjbGFzc2VzTGlzdC5wdXNoKGNsYXNzSXRlbSk7XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICB2YXIgY2xhc3NlcyA9IGNsYXNzZXNMaXN0LmpvaW4oXCIgXCIpO1xyXG5cclxuICAgIGVSb3cuY2xhc3NOYW1lID0gY2xhc3NlcztcclxufTtcclxuXHJcblJvd1JlbmRlcmVyLnByb3RvdHlwZS5jcmVhdGVSb3dDb250YWluZXIgPSBmdW5jdGlvbihyb3dJbmRleCwgbm9kZSwgZ3JvdXBSb3cpIHtcclxuICAgIHZhciBlUm93ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcclxuXHJcbiAgICB0aGlzLmFkZENsYXNzZXNUb1Jvdyhyb3dJbmRleCwgbm9kZSwgZVJvdyk7XHJcblxyXG4gICAgZVJvdy5zZXRBdHRyaWJ1dGUoXCJyb3dcIiwgcm93SW5kZXgpO1xyXG5cclxuICAgIC8vIGlmIHNob3dpbmcgc2Nyb2xscywgcG9zaXRpb24gb24gdGhlIGNvbnRhaW5lclxyXG4gICAgaWYgKCF0aGlzLmdyaWRPcHRpb25zV3JhcHBlci5pc0RvbnRVc2VTY3JvbGxzKCkpIHtcclxuICAgICAgICBlUm93LnN0eWxlLnRvcCA9ICh0aGlzLmdyaWRPcHRpb25zV3JhcHBlci5nZXRSb3dIZWlnaHQoKSAqIHJvd0luZGV4KSArIFwicHhcIjtcclxuICAgIH1cclxuICAgIGVSb3cuc3R5bGUuaGVpZ2h0ID0gKHRoaXMuZ3JpZE9wdGlvbnNXcmFwcGVyLmdldFJvd0hlaWdodCgpKSArIFwicHhcIjtcclxuXHJcbiAgICBpZiAodGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuZ2V0Um93U3R5bGUoKSkge1xyXG4gICAgICAgIHZhciBjc3NUb1VzZTtcclxuICAgICAgICB2YXIgcm93U3R5bGUgPSB0aGlzLmdyaWRPcHRpb25zV3JhcHBlci5nZXRSb3dTdHlsZSgpO1xyXG4gICAgICAgIGlmICh0eXBlb2Ygcm93U3R5bGUgPT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgICAgICAgY3NzVG9Vc2UgPSByb3dTdHlsZShub2RlLmRhdGEsIHJvd0luZGV4LCBncm91cFJvdyk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgY3NzVG9Vc2UgPSByb3dTdHlsZTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChjc3NUb1VzZSkge1xyXG4gICAgICAgICAgICBPYmplY3Qua2V5cyhjc3NUb1VzZSkuZm9yRWFjaChmdW5jdGlvbihrZXkpIHtcclxuICAgICAgICAgICAgICAgIGVSb3cuc3R5bGVba2V5XSA9IGNzc1RvVXNlW2tleV07XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICB2YXIgX3RoaXMgPSB0aGlzO1xyXG4gICAgZVJvdy5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgZnVuY3Rpb24oZXZlbnQpIHtcclxuICAgICAgICBfdGhpcy5hbmd1bGFyR3JpZC5vblJvd0NsaWNrZWQoZXZlbnQsIE51bWJlcih0aGlzLmdldEF0dHJpYnV0ZShcInJvd1wiKSksIG5vZGUpXHJcbiAgICB9KTtcclxuXHJcbiAgICByZXR1cm4gZVJvdztcclxufTtcclxuXHJcblJvd1JlbmRlcmVyLnByb3RvdHlwZS5nZXRJbmRleE9mUmVuZGVyZWROb2RlID0gZnVuY3Rpb24obm9kZSkge1xyXG4gICAgdmFyIHJlbmRlcmVkUm93cyA9IHRoaXMucmVuZGVyZWRSb3dzO1xyXG4gICAgdmFyIGtleXMgPSBPYmplY3Qua2V5cyhyZW5kZXJlZFJvd3MpO1xyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBrZXlzLmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgaWYgKHJlbmRlcmVkUm93c1trZXlzW2ldXS5ub2RlID09PSBub2RlKSB7XHJcbiAgICAgICAgICAgIHJldHVybiByZW5kZXJlZFJvd3Nba2V5c1tpXV0ucm93SW5kZXg7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIC0xO1xyXG59O1xyXG5cclxuUm93UmVuZGVyZXIucHJvdG90eXBlLnNldENzc0NsYXNzRm9yR3JvdXBDZWxsID0gZnVuY3Rpb24oZUdyaWRHcm91cFJvdywgZm9vdGVyLCB1c2VFbnRpcmVSb3csIGZpcnN0Q29sdW1uSW5kZXgpIHtcclxuICAgIGlmICh1c2VFbnRpcmVSb3cpIHtcclxuICAgICAgICBpZiAoZm9vdGVyKSB7XHJcbiAgICAgICAgICAgIGVHcmlkR3JvdXBSb3cuY2xhc3NOYW1lID0gJ2FnLWZvb3Rlci1jZWxsLWVudGlyZS1yb3cnO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGVHcmlkR3JvdXBSb3cuY2xhc3NOYW1lID0gJ2FnLWdyb3VwLWNlbGwtZW50aXJlLXJvdyc7XHJcbiAgICAgICAgfVxyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICBpZiAoZm9vdGVyKSB7XHJcbiAgICAgICAgICAgIGVHcmlkR3JvdXBSb3cuY2xhc3NOYW1lID0gJ2FnLWZvb3Rlci1jZWxsIGFnLWNlbGwgY2VsbC1jb2wtJyArIGZpcnN0Q29sdW1uSW5kZXg7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgZUdyaWRHcm91cFJvdy5jbGFzc05hbWUgPSAnYWctZ3JvdXAtY2VsbCBhZy1jZWxsIGNlbGwtY29sLScgKyBmaXJzdENvbHVtbkluZGV4O1xyXG4gICAgICAgIH1cclxuICAgIH1cclxufTtcclxuXHJcblJvd1JlbmRlcmVyLnByb3RvdHlwZS5jcmVhdGVHcm91cEVsZW1lbnQgPSBmdW5jdGlvbihub2RlLCBmaXJzdENvbHVtbiwgdXNlRW50aXJlUm93LCBwYWRkaW5nLCByb3dJbmRleCwgZm9vdGVyKSB7XHJcbiAgICB2YXIgZUdyaWRHcm91cFJvdyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xyXG5cclxuICAgIHRoaXMuc2V0Q3NzQ2xhc3NGb3JHcm91cENlbGwoZUdyaWRHcm91cFJvdywgZm9vdGVyLCB1c2VFbnRpcmVSb3csIGZpcnN0Q29sdW1uLmluZGV4KTtcclxuXHJcbiAgICB2YXIgZXhwYW5kSWNvbk5lZWRlZCA9ICFwYWRkaW5nICYmICFmb290ZXI7XHJcbiAgICBpZiAoZXhwYW5kSWNvbk5lZWRlZCkge1xyXG4gICAgICAgIHRoaXMuYWRkR3JvdXBFeHBhbmRJY29uKGVHcmlkR3JvdXBSb3csIG5vZGUuZXhwYW5kZWQpO1xyXG4gICAgfVxyXG5cclxuICAgIHZhciBjaGVja2JveE5lZWRlZCA9ICFwYWRkaW5nICYmICFmb290ZXIgJiYgdGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuaXNHcm91cENoZWNrYm94U2VsZWN0aW9uKCk7XHJcbiAgICBpZiAoY2hlY2tib3hOZWVkZWQpIHtcclxuICAgICAgICB2YXIgZUNoZWNrYm94ID0gdGhpcy5zZWxlY3Rpb25SZW5kZXJlckZhY3RvcnkuY3JlYXRlU2VsZWN0aW9uQ2hlY2tib3gobm9kZSwgcm93SW5kZXgpO1xyXG4gICAgICAgIGVHcmlkR3JvdXBSb3cuYXBwZW5kQ2hpbGQoZUNoZWNrYm94KTtcclxuICAgIH1cclxuXHJcbiAgICAvLyB0cnkgdXNlciBjdXN0b20gcmVuZGVyaW5nIGZpcnN0XHJcbiAgICB2YXIgdXNlUmVuZGVyZXIgPSB0eXBlb2YgdGhpcy5ncmlkT3B0aW9ucy5ncm91cElubmVyQ2VsbFJlbmRlcmVyID09PSAnZnVuY3Rpb24nO1xyXG4gICAgaWYgKHVzZVJlbmRlcmVyKSB7XHJcbiAgICAgICAgdmFyIHJlbmRlcmVyUGFyYW1zID0ge1xyXG4gICAgICAgICAgICBkYXRhOiBub2RlLmRhdGEsXHJcbiAgICAgICAgICAgIG5vZGU6IG5vZGUsXHJcbiAgICAgICAgICAgIHBhZGRpbmc6IHBhZGRpbmcsXHJcbiAgICAgICAgICAgIGdyaWRPcHRpb25zOiB0aGlzLmdyaWRPcHRpb25zLFxyXG4gICAgICAgICAgICBjb250ZXh0OiB0aGlzLmdyaWRPcHRpb25zV3JhcHBlci5nZXRDb250ZXh0KClcclxuICAgICAgICB9O1xyXG4gICAgICAgIHV0aWxzLnVzZVJlbmRlcmVyKGVHcmlkR3JvdXBSb3csIHRoaXMuZ3JpZE9wdGlvbnMuZ3JvdXBJbm5lckNlbGxSZW5kZXJlciwgcmVuZGVyZXJQYXJhbXMpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICBpZiAoIXBhZGRpbmcpIHtcclxuICAgICAgICAgICAgaWYgKGZvb3Rlcikge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5jcmVhdGVGb290ZXJDZWxsKGVHcmlkR3JvdXBSb3csIG5vZGUpO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5jcmVhdGVHcm91cENlbGwoZUdyaWRHcm91cFJvdywgbm9kZSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCF1c2VFbnRpcmVSb3cpIHtcclxuICAgICAgICBlR3JpZEdyb3VwUm93LnN0eWxlLndpZHRoID0gdXRpbHMuZm9ybWF0V2lkdGgoZmlyc3RDb2x1bW4uYWN0dWFsV2lkdGgpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIGluZGVudCB3aXRoIHRoZSBncm91cCBsZXZlbFxyXG4gICAgaWYgKCFwYWRkaW5nKSB7XHJcbiAgICAgICAgLy8gb25seSBkbyB0aGlzIGlmIGFuIGluZGVudCAtIGFzIHRoaXMgb3ZlcndyaXRlcyB0aGUgcGFkZGluZyB0aGF0XHJcbiAgICAgICAgLy8gdGhlIHRoZW1lIHNldCwgd2hpY2ggd2lsbCBtYWtlIHRoaW5ncyBsb29rICdub3QgYWxpZ25lZCcgZm9yIHRoZVxyXG4gICAgICAgIC8vIGZpcnN0IGdyb3VwIGxldmVsLlxyXG4gICAgICAgIGlmIChub2RlLmZvb3RlciB8fCBub2RlLmxldmVsID4gMCkge1xyXG4gICAgICAgICAgICB2YXIgcGFkZGluZ1B4ID0gbm9kZS5sZXZlbCAqIDEwO1xyXG4gICAgICAgICAgICBpZiAoZm9vdGVyKSB7XHJcbiAgICAgICAgICAgICAgICBwYWRkaW5nUHggKz0gMTA7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgZUdyaWRHcm91cFJvdy5zdHlsZS5wYWRkaW5nTGVmdCA9IHBhZGRpbmdQeCArIFwicHhcIjtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgZUdyaWRHcm91cFJvdy5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgbm9kZS5leHBhbmRlZCA9ICFub2RlLmV4cGFuZGVkO1xyXG4gICAgICAgIHRoYXQuYW5ndWxhckdyaWQudXBkYXRlTW9kZWxBbmRSZWZyZXNoKGNvbnN0YW50cy5TVEVQX01BUCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICByZXR1cm4gZUdyaWRHcm91cFJvdztcclxufTtcclxuXHJcbi8vIGNyZWF0ZXMgY2VsbCB3aXRoICdUb3RhbCB7e2tleX19JyBmb3IgYSBncm91cFxyXG5Sb3dSZW5kZXJlci5wcm90b3R5cGUuY3JlYXRlRm9vdGVyQ2VsbCA9IGZ1bmN0aW9uKGVQYXJlbnQsIG5vZGUpIHtcclxuICAgIC8vIGlmIHdlIGFyZSBkb2luZyBjZWxsIC0gdGhlbiBpdCBtYWtlcyBzZW5zZSB0byBwdXQgaW4gJ3RvdGFsJywgd2hpY2ggaXMganVzdCBhIGJlc3QgZ3Vlc3MsXHJcbiAgICAvLyB0aGF0IHRoZSB1c2VyIGlzIGdvaW5nIHRvIHdhbnQgdG8gc2F5ICd0b3RhbCcuIHR5cGljYWxseSBpIGV4cGVjdCB0aGUgdXNlciB0byBvdmVycmlkZVxyXG4gICAgLy8gaG93IHRoaXMgY2VsbCBpcyByZW5kZXJlZFxyXG4gICAgdmFyIHRleHRUb0Rpc3BsYXk7XHJcbiAgICBpZiAodGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuaXNHcm91cFVzZUVudGlyZVJvdygpKSB7XHJcbiAgICAgICAgdGV4dFRvRGlzcGxheSA9IFwiR3JvdXAgZm9vdGVyIC0geW91IHNob3VsZCBwcm92aWRlIGEgY3VzdG9tIGdyb3VwSW5uZXJDZWxsUmVuZGVyZXIgdG8gcmVuZGVyIHdoYXQgbWFrZXMgc2Vuc2UgZm9yIHlvdVwiXHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHRleHRUb0Rpc3BsYXkgPSBcIlRvdGFsIFwiICsgbm9kZS5rZXk7XHJcbiAgICB9XHJcbiAgICB2YXIgZVRleHQgPSBkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZSh0ZXh0VG9EaXNwbGF5KTtcclxuICAgIGVQYXJlbnQuYXBwZW5kQ2hpbGQoZVRleHQpO1xyXG59O1xyXG5cclxuLy8gY3JlYXRlcyBjZWxsIHdpdGggJ3t7a2V5fX0gKHt7Y2hpbGRDb3VudH19KScgZm9yIGEgZ3JvdXBcclxuUm93UmVuZGVyZXIucHJvdG90eXBlLmNyZWF0ZUdyb3VwQ2VsbCA9IGZ1bmN0aW9uKGVQYXJlbnQsIG5vZGUpIHtcclxuICAgIHZhciB0ZXh0VG9EaXNwbGF5ID0gXCIgXCIgKyBub2RlLmtleTtcclxuICAgIC8vIG9ubHkgaW5jbHVkZSB0aGUgY2hpbGQgY291bnQgaWYgaXQncyBpbmNsdWRlZCwgZWcgaWYgdXNlciBkb2luZyBjdXN0b20gYWdncmVnYXRpb24sXHJcbiAgICAvLyB0aGVuIHRoaXMgY291bGQgYmUgbGVmdCBvdXQsIG9yIHNldCB0byAtMSwgaWUgbm8gY2hpbGQgY291bnRcclxuICAgIGlmIChub2RlLmFsbENoaWxkcmVuQ291bnQgPj0gMCkge1xyXG4gICAgICAgIHRleHRUb0Rpc3BsYXkgKz0gXCIgKFwiICsgbm9kZS5hbGxDaGlsZHJlbkNvdW50ICsgXCIpXCI7XHJcbiAgICB9XHJcbiAgICB2YXIgZVRleHQgPSBkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZSh0ZXh0VG9EaXNwbGF5KTtcclxuICAgIGVQYXJlbnQuYXBwZW5kQ2hpbGQoZVRleHQpO1xyXG59O1xyXG5cclxuUm93UmVuZGVyZXIucHJvdG90eXBlLmFkZEdyb3VwRXhwYW5kSWNvbiA9IGZ1bmN0aW9uKGVHcmlkR3JvdXBSb3csIGV4cGFuZGVkKSB7XHJcbiAgICB2YXIgZUdyb3VwSWNvbjtcclxuICAgIGlmIChleHBhbmRlZCkge1xyXG4gICAgICAgIGVHcm91cEljb24gPSB1dGlscy5jcmVhdGVJY29uKCdncm91cEV4cGFuZGVkJywgdGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIsIG51bGwsIHN2Z0ZhY3RvcnkuY3JlYXRlQXJyb3dEb3duU3ZnKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgZUdyb3VwSWNvbiA9IHV0aWxzLmNyZWF0ZUljb24oJ2dyb3VwQ29udHJhY3RlZCcsIHRoaXMuZ3JpZE9wdGlvbnNXcmFwcGVyLCBudWxsLCBzdmdGYWN0b3J5LmNyZWF0ZUFycm93UmlnaHRTdmcpO1xyXG4gICAgfVxyXG5cclxuICAgIGVHcmlkR3JvdXBSb3cuYXBwZW5kQ2hpbGQoZUdyb3VwSWNvbik7XHJcbn07XHJcblxyXG5Sb3dSZW5kZXJlci5wcm90b3R5cGUucHV0RGF0YUludG9DZWxsID0gZnVuY3Rpb24oY29sRGVmLCB2YWx1ZSwgbm9kZSwgJGNoaWxkU2NvcGUsIGVHcmlkQ2VsbCwgcm93SW5kZXgpIHtcclxuICAgIGlmIChjb2xEZWYuY2VsbFJlbmRlcmVyKSB7XHJcbiAgICAgICAgdmFyIHJlbmRlcmVyUGFyYW1zID0ge1xyXG4gICAgICAgICAgICB2YWx1ZTogdmFsdWUsXHJcbiAgICAgICAgICAgIGRhdGE6IG5vZGUuZGF0YSxcclxuICAgICAgICAgICAgbm9kZTogbm9kZSxcclxuICAgICAgICAgICAgY29sRGVmOiBjb2xEZWYsXHJcbiAgICAgICAgICAgICRzY29wZTogJGNoaWxkU2NvcGUsXHJcbiAgICAgICAgICAgIHJvd0luZGV4OiByb3dJbmRleCxcclxuICAgICAgICAgICAgZ3JpZE9wdGlvbnM6IHRoaXMuZ3JpZE9wdGlvbnNXcmFwcGVyLmdldEdyaWRPcHRpb25zKCksXHJcbiAgICAgICAgICAgIGNvbnRleHQ6IHRoaXMuZ3JpZE9wdGlvbnNXcmFwcGVyLmdldENvbnRleHQoKVxyXG4gICAgICAgIH07XHJcbiAgICAgICAgdmFyIHJlc3VsdEZyb21SZW5kZXJlciA9IGNvbERlZi5jZWxsUmVuZGVyZXIocmVuZGVyZXJQYXJhbXMpO1xyXG4gICAgICAgIGlmICh1dGlscy5pc05vZGUocmVzdWx0RnJvbVJlbmRlcmVyKSB8fCB1dGlscy5pc0VsZW1lbnQocmVzdWx0RnJvbVJlbmRlcmVyKSkge1xyXG4gICAgICAgICAgICAvLyBhIGRvbSBub2RlIG9yIGVsZW1lbnQgd2FzIHJldHVybmVkLCBzbyBhZGQgY2hpbGRcclxuICAgICAgICAgICAgZUdyaWRDZWxsLmFwcGVuZENoaWxkKHJlc3VsdEZyb21SZW5kZXJlcik7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgLy8gb3RoZXJ3aXNlIGFzc3VtZSBpdCB3YXMgaHRtbCwgc28ganVzdCBpbnNlcnRcclxuICAgICAgICAgICAgZUdyaWRDZWxsLmlubmVySFRNTCA9IHJlc3VsdEZyb21SZW5kZXJlcjtcclxuICAgICAgICB9XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIC8vIGlmIHdlIGluc2VydCB1bmRlZmluZWQsIHRoZW4gaXQgZGlzcGxheXMgYXMgdGhlIHN0cmluZyAndW5kZWZpbmVkJywgdWdseSFcclxuICAgICAgICBpZiAodmFsdWUgIT09IHVuZGVmaW5lZCAmJiB2YWx1ZSAhPT0gbnVsbCAmJiB2YWx1ZSAhPT0gJycpIHtcclxuICAgICAgICAgICAgZUdyaWRDZWxsLmlubmVySFRNTCA9IHZhbHVlO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxufTtcclxuXHJcblJvd1JlbmRlcmVyLnByb3RvdHlwZS5jcmVhdGVDZWxsID0gZnVuY3Rpb24oaXNGaXJzdENvbHVtbiwgY29sdW1uLCB2YWx1ZSwgbm9kZSwgcm93SW5kZXgsICRjaGlsZFNjb3BlKSB7XHJcbiAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICB2YXIgZUdyaWRDZWxsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcclxuICAgIGVHcmlkQ2VsbC5zZXRBdHRyaWJ1dGUoXCJjb2xcIiwgY29sdW1uLmluZGV4KTtcclxuXHJcbiAgICAvLyBzZXQgY2xhc3MsIG9ubHkgaW5jbHVkZSBhZy1ncm91cC1jZWxsIGlmIGl0J3MgYSBncm91cCBjZWxsXHJcbiAgICB2YXIgY2xhc3NlcyA9IFsnYWctY2VsbCcsICdjZWxsLWNvbC0nICsgY29sdW1uLmluZGV4XTtcclxuICAgIGlmIChub2RlLmdyb3VwKSB7XHJcbiAgICAgICAgaWYgKG5vZGUuZm9vdGVyKSB7XHJcbiAgICAgICAgICAgIGNsYXNzZXMucHVzaCgnYWctZm9vdGVyLWNlbGwnKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBjbGFzc2VzLnB1c2goJ2FnLWdyb3VwLWNlbGwnKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBlR3JpZENlbGwuY2xhc3NOYW1lID0gY2xhc3Nlcy5qb2luKCcgJyk7XHJcblxyXG4gICAgdmFyIGVDZWxsV3JhcHBlciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NwYW4nKTtcclxuICAgIGVHcmlkQ2VsbC5hcHBlbmRDaGlsZChlQ2VsbFdyYXBwZXIpO1xyXG5cclxuICAgIC8vIHNlZSBpZiB3ZSBuZWVkIGEgcGFkZGluZyBib3hcclxuICAgIGlmIChpc0ZpcnN0Q29sdW1uICYmIChub2RlLnBhcmVudCkpIHtcclxuICAgICAgICB2YXIgcGl4ZWxzVG9JbmRlbnQgPSAyMCArIChub2RlLnBhcmVudC5sZXZlbCAqIDEwKTtcclxuICAgICAgICBlQ2VsbFdyYXBwZXIuc3R5bGVbJ3BhZGRpbmctbGVmdCddID0gcGl4ZWxzVG9JbmRlbnQgKyAncHgnO1xyXG4gICAgfVxyXG5cclxuICAgIHZhciBjb2xEZWYgPSBjb2x1bW4uY29sRGVmO1xyXG4gICAgaWYgKGNvbERlZi5jaGVja2JveFNlbGVjdGlvbikge1xyXG4gICAgICAgIHZhciBlQ2hlY2tib3ggPSB0aGlzLnNlbGVjdGlvblJlbmRlcmVyRmFjdG9yeS5jcmVhdGVTZWxlY3Rpb25DaGVja2JveChub2RlLCByb3dJbmRleCk7XHJcbiAgICAgICAgZUNlbGxXcmFwcGVyLmFwcGVuZENoaWxkKGVDaGVja2JveCk7XHJcbiAgICB9XHJcblxyXG4gICAgdmFyIGVTcGFuV2l0aFZhbHVlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XHJcbiAgICBlQ2VsbFdyYXBwZXIuYXBwZW5kQ2hpbGQoZVNwYW5XaXRoVmFsdWUpO1xyXG4gICAgdGhpcy5wdXREYXRhSW50b0NlbGwoY29sRGVmLCB2YWx1ZSwgbm9kZSwgJGNoaWxkU2NvcGUsIGVTcGFuV2l0aFZhbHVlLCByb3dJbmRleCk7XHJcblxyXG4gICAgaWYgKGNvbERlZi5jZWxsU3R5bGUpIHtcclxuICAgICAgICB2YXIgY3NzVG9Vc2U7XHJcbiAgICAgICAgaWYgKHR5cGVvZiBjb2xEZWYuY2VsbFN0eWxlID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgICAgIHZhciBjZWxsU3R5bGVQYXJhbXMgPSB7XHJcbiAgICAgICAgICAgICAgICB2YWx1ZTogdmFsdWUsXHJcbiAgICAgICAgICAgICAgICBkYXRhOiBub2RlLmRhdGEsXHJcbiAgICAgICAgICAgICAgICBub2RlOiBub2RlLFxyXG4gICAgICAgICAgICAgICAgY29sRGVmOiBjb2xEZWYsXHJcbiAgICAgICAgICAgICAgICAkc2NvcGU6ICRjaGlsZFNjb3BlLFxyXG4gICAgICAgICAgICAgICAgY29udGV4dDogdGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuZ2V0Q29udGV4dCgpLFxyXG4gICAgICAgICAgICAgICAgZ3JpZE9wdGlvbnM6IHRoaXMuZ3JpZE9wdGlvbnNXcmFwcGVyLmdldEdyaWRPcHRpb25zKClcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgY3NzVG9Vc2UgPSBjb2xEZWYuY2VsbFN0eWxlKGNlbGxTdHlsZVBhcmFtcyk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgY3NzVG9Vc2UgPSBjb2xEZWYuY2VsbFN0eWxlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKGNzc1RvVXNlKSB7XHJcbiAgICAgICAgICAgIE9iamVjdC5rZXlzKGNzc1RvVXNlKS5mb3JFYWNoKGZ1bmN0aW9uKGtleSkge1xyXG4gICAgICAgICAgICAgICAgZUdyaWRDZWxsLnN0eWxlW2tleV0gPSBjc3NUb1VzZVtrZXldO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGNvbERlZi5jZWxsQ2xhc3MpIHtcclxuICAgICAgICB2YXIgY2xhc3NUb1VzZTtcclxuICAgICAgICBpZiAodHlwZW9mIGNvbERlZi5jZWxsQ2xhc3MgPT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgICAgICAgdmFyIGNlbGxDbGFzc1BhcmFtcyA9IHtcclxuICAgICAgICAgICAgICAgIHZhbHVlOiB2YWx1ZSxcclxuICAgICAgICAgICAgICAgIGRhdGE6IG5vZGUuZGF0YSxcclxuICAgICAgICAgICAgICAgIG5vZGU6IG5vZGUsXHJcbiAgICAgICAgICAgICAgICBjb2xEZWY6IGNvbERlZixcclxuICAgICAgICAgICAgICAgICRzY29wZTogJGNoaWxkU2NvcGUsXHJcbiAgICAgICAgICAgICAgICBjb250ZXh0OiB0aGlzLmdyaWRPcHRpb25zV3JhcHBlci5nZXRDb250ZXh0KCksXHJcbiAgICAgICAgICAgICAgICBncmlkT3B0aW9uczogdGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuZ2V0R3JpZE9wdGlvbnMoKVxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICBjbGFzc1RvVXNlID0gY29sRGVmLmNlbGxDbGFzcyhjZWxsQ2xhc3NQYXJhbXMpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGNsYXNzVG9Vc2UgPSBjb2xEZWYuY2VsbENsYXNzO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKHR5cGVvZiBjbGFzc1RvVXNlID09PSAnc3RyaW5nJykge1xyXG4gICAgICAgICAgICB1dGlscy5hZGRDc3NDbGFzcyhlR3JpZENlbGwsIGNsYXNzVG9Vc2UpO1xyXG4gICAgICAgIH0gZWxzZSBpZiAoQXJyYXkuaXNBcnJheShjbGFzc1RvVXNlKSkge1xyXG4gICAgICAgICAgICBjbGFzc1RvVXNlLmZvckVhY2goZnVuY3Rpb24oY3NzQ2xhc3NJdGVtKSB7XHJcbiAgICAgICAgICAgICAgICB1dGlscy5hZGRDc3NDbGFzcyhlR3JpZENlbGwsIGNzc0NsYXNzSXRlbSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICB0aGlzLmFkZENlbGxDbGlja2VkSGFuZGxlcihlR3JpZENlbGwsIG5vZGUsIGNvbHVtbiwgdmFsdWUsIHJvd0luZGV4KTtcclxuICAgIHRoaXMuYWRkQ2VsbERvdWJsZUNsaWNrZWRIYW5kbGVyKGVHcmlkQ2VsbCwgbm9kZSwgY29sdW1uLCB2YWx1ZSwgcm93SW5kZXgsICRjaGlsZFNjb3BlKTtcclxuXHJcbiAgICBlR3JpZENlbGwuc3R5bGUud2lkdGggPSB1dGlscy5mb3JtYXRXaWR0aChjb2x1bW4uYWN0dWFsV2lkdGgpO1xyXG5cclxuICAgIC8vIGFkZCB0aGUgJ3N0YXJ0IGVkaXRpbmcnIGNhbGwgdG8gdGhlIGNoYWluIG9mIGVkaXRvcnNcclxuICAgIHRoaXMucmVuZGVyZWRSb3dTdGFydEVkaXRpbmdMaXN0ZW5lcnNbcm93SW5kZXhdW2NvbHVtbi5pbmRleF0gPSBmdW5jdGlvbigpIHtcclxuICAgICAgICBpZiAodGhhdC5pc0NlbGxFZGl0YWJsZShjb2xEZWYsIG5vZGUpKSB7XHJcbiAgICAgICAgICAgIHRoYXQuc3RhcnRFZGl0aW5nKGVHcmlkQ2VsbCwgY29sdW1uLCBub2RlLCAkY2hpbGRTY29wZSwgcm93SW5kZXgpO1xyXG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuXHJcbiAgICByZXR1cm4gZUdyaWRDZWxsO1xyXG59O1xyXG5cclxuUm93UmVuZGVyZXIucHJvdG90eXBlLmFkZENlbGxEb3VibGVDbGlja2VkSGFuZGxlciA9IGZ1bmN0aW9uKGVHcmlkQ2VsbCwgbm9kZSwgY29sdW1uLCB2YWx1ZSwgcm93SW5kZXgsICRjaGlsZFNjb3BlKSB7XHJcbiAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICB2YXIgY29sRGVmID0gY29sdW1uLmNvbERlZjtcclxuICAgIGVHcmlkQ2VsbC5hZGRFdmVudExpc3RlbmVyKFwiZGJsY2xpY2tcIiwgZnVuY3Rpb24oZXZlbnQpIHtcclxuICAgICAgICBpZiAodGhhdC5ncmlkT3B0aW9uc1dyYXBwZXIuZ2V0Q2VsbERvdWJsZUNsaWNrZWQoKSkge1xyXG4gICAgICAgICAgICB2YXIgcGFyYW1zRm9yR3JpZCA9IHtcclxuICAgICAgICAgICAgICAgIG5vZGU6IG5vZGUsXHJcbiAgICAgICAgICAgICAgICBkYXRhOiBub2RlLmRhdGEsXHJcbiAgICAgICAgICAgICAgICB2YWx1ZTogdmFsdWUsXHJcbiAgICAgICAgICAgICAgICByb3dJbmRleDogcm93SW5kZXgsXHJcbiAgICAgICAgICAgICAgICBjb2xEZWY6IGNvbERlZixcclxuICAgICAgICAgICAgICAgIGV2ZW50OiBldmVudCxcclxuICAgICAgICAgICAgICAgIGV2ZW50U291cmNlOiB0aGlzLFxyXG4gICAgICAgICAgICAgICAgZ3JpZE9wdGlvbnM6IHRoYXQuZ3JpZE9wdGlvbnNXcmFwcGVyLmdldEdyaWRPcHRpb25zKClcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgdGhhdC5ncmlkT3B0aW9uc1dyYXBwZXIuZ2V0Q2VsbERvdWJsZUNsaWNrZWQoKShwYXJhbXNGb3JHcmlkKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKGNvbERlZi5jZWxsRG91YmxlQ2xpY2tlZCkge1xyXG4gICAgICAgICAgICB2YXIgcGFyYW1zRm9yQ29sRGVmID0ge1xyXG4gICAgICAgICAgICAgICAgbm9kZTogbm9kZSxcclxuICAgICAgICAgICAgICAgIGRhdGE6IG5vZGUuZGF0YSxcclxuICAgICAgICAgICAgICAgIHZhbHVlOiB2YWx1ZSxcclxuICAgICAgICAgICAgICAgIHJvd0luZGV4OiByb3dJbmRleCxcclxuICAgICAgICAgICAgICAgIGNvbERlZjogY29sRGVmLFxyXG4gICAgICAgICAgICAgICAgZXZlbnQ6IGV2ZW50LFxyXG4gICAgICAgICAgICAgICAgZXZlbnRTb3VyY2U6IHRoaXMsXHJcbiAgICAgICAgICAgICAgICBncmlkT3B0aW9uczogdGhhdC5ncmlkT3B0aW9uc1dyYXBwZXIuZ2V0R3JpZE9wdGlvbnMoKVxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICBjb2xEZWYuY2VsbERvdWJsZUNsaWNrZWQocGFyYW1zRm9yQ29sRGVmKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKHRoYXQuaXNDZWxsRWRpdGFibGUoY29sRGVmLCBub2RlKSkge1xyXG4gICAgICAgICAgICB0aGF0LnN0YXJ0RWRpdGluZyhlR3JpZENlbGwsIGNvbHVtbiwgbm9kZSwgJGNoaWxkU2NvcGUsIHJvd0luZGV4KTtcclxuICAgICAgICB9XHJcbiAgICB9KTtcclxufTtcclxuXHJcblJvd1JlbmRlcmVyLnByb3RvdHlwZS5hZGRDZWxsQ2xpY2tlZEhhbmRsZXIgPSBmdW5jdGlvbihlR3JpZENlbGwsIG5vZGUsIGNvbERlZldyYXBwZXIsIHZhbHVlLCByb3dJbmRleCkge1xyXG4gICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgdmFyIGNvbERlZiA9IGNvbERlZldyYXBwZXIuY29sRGVmO1xyXG4gICAgZUdyaWRDZWxsLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBmdW5jdGlvbihldmVudCkge1xyXG4gICAgICAgIGlmICh0aGF0LmdyaWRPcHRpb25zV3JhcHBlci5nZXRDZWxsQ2xpY2tlZCgpKSB7XHJcbiAgICAgICAgICAgIHZhciBwYXJhbXNGb3JHcmlkID0ge1xyXG4gICAgICAgICAgICAgICAgbm9kZTogbm9kZSxcclxuICAgICAgICAgICAgICAgIGRhdGE6IG5vZGUuZGF0YSxcclxuICAgICAgICAgICAgICAgIHZhbHVlOiB2YWx1ZSxcclxuICAgICAgICAgICAgICAgIHJvd0luZGV4OiByb3dJbmRleCxcclxuICAgICAgICAgICAgICAgIGNvbERlZjogY29sRGVmLFxyXG4gICAgICAgICAgICAgICAgZXZlbnQ6IGV2ZW50LFxyXG4gICAgICAgICAgICAgICAgZXZlbnRTb3VyY2U6IHRoaXMsXHJcbiAgICAgICAgICAgICAgICBncmlkT3B0aW9uczogdGhhdC5ncmlkT3B0aW9uc1dyYXBwZXIuZ2V0R3JpZE9wdGlvbnMoKVxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB0aGF0LmdyaWRPcHRpb25zV3JhcHBlci5nZXRDZWxsQ2xpY2tlZCgpKHBhcmFtc0ZvckdyaWQpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoY29sRGVmLmNlbGxDbGlja2VkKSB7XHJcbiAgICAgICAgICAgIHZhciBwYXJhbXNGb3JDb2xEZWYgPSB7XHJcbiAgICAgICAgICAgICAgICBub2RlOiBub2RlLFxyXG4gICAgICAgICAgICAgICAgZGF0YTogbm9kZS5kYXRhLFxyXG4gICAgICAgICAgICAgICAgdmFsdWU6IHZhbHVlLFxyXG4gICAgICAgICAgICAgICAgcm93SW5kZXg6IHJvd0luZGV4LFxyXG4gICAgICAgICAgICAgICAgY29sRGVmOiBjb2xEZWYsXHJcbiAgICAgICAgICAgICAgICBldmVudDogZXZlbnQsXHJcbiAgICAgICAgICAgICAgICBldmVudFNvdXJjZTogdGhpcyxcclxuICAgICAgICAgICAgICAgIGdyaWRPcHRpb25zOiB0aGF0LmdyaWRPcHRpb25zV3JhcHBlci5nZXRHcmlkT3B0aW9ucygpXHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIGNvbERlZi5jZWxsQ2xpY2tlZChwYXJhbXNGb3JDb2xEZWYpO1xyXG4gICAgICAgIH1cclxuICAgIH0pO1xyXG59O1xyXG5cclxuUm93UmVuZGVyZXIucHJvdG90eXBlLmlzQ2VsbEVkaXRhYmxlID0gZnVuY3Rpb24oY29sRGVmLCBub2RlKSB7XHJcbiAgICBpZiAodGhpcy5lZGl0aW5nQ2VsbCkge1xyXG4gICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBuZXZlciBhbGxvdyBlZGl0aW5nIG9mIGdyb3Vwc1xyXG4gICAgaWYgKG5vZGUuZ3JvdXApIHtcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gaWYgYm9vbGVhbiBzZXQsIHRoZW4ganVzdCB1c2UgaXRcclxuICAgIGlmICh0eXBlb2YgY29sRGVmLmVkaXRhYmxlID09PSAnYm9vbGVhbicpIHtcclxuICAgICAgICByZXR1cm4gY29sRGVmLmVkaXRhYmxlO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIGlmIGZ1bmN0aW9uLCB0aGVuIGNhbGwgdGhlIGZ1bmN0aW9uIHRvIGZpbmQgb3V0XHJcbiAgICBpZiAodHlwZW9mIGNvbERlZi5lZGl0YWJsZSA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICAgIC8vIHNob3VsZCBjaGFuZ2UgdGhpcywgc28gaXQgZ2V0cyBwYXNzZWQgcGFyYW1zIHdpdGggbmljZSB1c2VmdWwgdmFsdWVzXHJcbiAgICAgICAgcmV0dXJuIGNvbERlZi5lZGl0YWJsZShub2RlLmRhdGEpO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBmYWxzZTtcclxufTtcclxuXHJcblJvd1JlbmRlcmVyLnByb3RvdHlwZS5zdG9wRWRpdGluZyA9IGZ1bmN0aW9uKGVHcmlkQ2VsbCwgY29sRGVmLCBub2RlLCAkY2hpbGRTY29wZSwgZUlucHV0LCBibHVyTGlzdGVuZXIsIHJvd0luZGV4KSB7XHJcbiAgICB0aGlzLmVkaXRpbmdDZWxsID0gZmFsc2U7XHJcbiAgICB2YXIgbmV3VmFsdWUgPSBlSW5wdXQudmFsdWU7XHJcblxyXG4gICAgLy9JZiB3ZSBkb24ndCByZW1vdmUgdGhlIGJsdXIgbGlzdGVuZXIgZmlyc3QsIHdlIGdldDpcclxuICAgIC8vVW5jYXVnaHQgTm90Rm91bmRFcnJvcjogRmFpbGVkIHRvIGV4ZWN1dGUgJ3JlbW92ZUNoaWxkJyBvbiAnTm9kZSc6IFRoZSBub2RlIHRvIGJlIHJlbW92ZWQgaXMgbm8gbG9uZ2VyIGEgY2hpbGQgb2YgdGhpcyBub2RlLiBQZXJoYXBzIGl0IHdhcyBtb3ZlZCBpbiBhICdibHVyJyBldmVudCBoYW5kbGVyP1xyXG4gICAgZUlucHV0LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2JsdXInLCBibHVyTGlzdGVuZXIpO1xyXG5cclxuICAgIHV0aWxzLnJlbW92ZUFsbENoaWxkcmVuKGVHcmlkQ2VsbCk7XHJcblxyXG4gICAgdmFyIHBhcmFtc0ZvckNhbGxiYWNrcyA9IHtcclxuICAgICAgICBub2RlOiBub2RlLFxyXG4gICAgICAgIGRhdGE6IG5vZGUuZGF0YSxcclxuICAgICAgICBvbGRWYWx1ZTogbm9kZS5kYXRhW2NvbERlZi5maWVsZF0sXHJcbiAgICAgICAgbmV3VmFsdWU6IG5ld1ZhbHVlLFxyXG4gICAgICAgIHJvd0luZGV4OiByb3dJbmRleCxcclxuICAgICAgICBjb2xEZWY6IGNvbERlZixcclxuICAgICAgICBjb250ZXh0OiB0aGlzLmdyaWRPcHRpb25zV3JhcHBlci5nZXRDb250ZXh0KCksXHJcbiAgICAgICAgZ3JpZE9wdGlvbnM6IHRoaXMuZ3JpZE9wdGlvbnNXcmFwcGVyLmdldEdyaWRPcHRpb25zKClcclxuICAgIH07XHJcblxyXG4gICAgaWYgKGNvbERlZi5uZXdWYWx1ZUhhbmRsZXIpIHtcclxuICAgICAgICBjb2xEZWYubmV3VmFsdWVIYW5kbGVyKHBhcmFtc0ZvckNhbGxiYWNrcyk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIG5vZGUuZGF0YVtjb2xEZWYuZmllbGRdID0gbmV3VmFsdWU7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gYXQgdGhpcyBwb2ludCwgdGhlIHZhbHVlIGhhcyBiZWVuIHVwZGF0ZWRcclxuICAgIHBhcmFtc0ZvckNhbGxiYWNrcy5uZXdWYWx1ZSA9IG5vZGUuZGF0YVtjb2xEZWYuZmllbGRdO1xyXG4gICAgaWYgKHR5cGVvZiBjb2xEZWYuY2VsbFZhbHVlQ2hhbmdlZCA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICAgIGNvbERlZi5jZWxsVmFsdWVDaGFuZ2VkKHBhcmFtc0ZvckNhbGxiYWNrcyk7XHJcbiAgICB9XHJcblxyXG4gICAgdmFyIHZhbHVlID0gbm9kZS5kYXRhW2NvbERlZi5maWVsZF07XHJcbiAgICB0aGlzLnB1dERhdGFJbnRvQ2VsbChjb2xEZWYsIHZhbHVlLCBub2RlLCAkY2hpbGRTY29wZSwgZUdyaWRDZWxsKTtcclxufTtcclxuXHJcblJvd1JlbmRlcmVyLnByb3RvdHlwZS5zdGFydEVkaXRpbmcgPSBmdW5jdGlvbihlR3JpZENlbGwsIGNvbHVtbiwgbm9kZSwgJGNoaWxkU2NvcGUsIHJvd0luZGV4KSB7XHJcbiAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICB2YXIgY29sRGVmID0gY29sdW1uLmNvbERlZjtcclxuICAgIHRoaXMuZWRpdGluZ0NlbGwgPSB0cnVlO1xyXG4gICAgdXRpbHMucmVtb3ZlQWxsQ2hpbGRyZW4oZUdyaWRDZWxsKTtcclxuICAgIHZhciBlSW5wdXQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdpbnB1dCcpO1xyXG4gICAgZUlucHV0LnR5cGUgPSAndGV4dCc7XHJcbiAgICB1dGlscy5hZGRDc3NDbGFzcyhlSW5wdXQsICdhZy1jZWxsLWVkaXQtaW5wdXQnKTtcclxuXHJcbiAgICB2YXIgdmFsdWUgPSBub2RlLmRhdGFbY29sRGVmLmZpZWxkXTtcclxuICAgIGlmICh2YWx1ZSAhPT0gbnVsbCAmJiB2YWx1ZSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgZUlucHV0LnZhbHVlID0gdmFsdWU7XHJcbiAgICB9XHJcblxyXG4gICAgZUlucHV0LnN0eWxlLndpZHRoID0gKGNvbHVtbi5hY3R1YWxXaWR0aCAtIDE0KSArICdweCc7XHJcbiAgICBlR3JpZENlbGwuYXBwZW5kQ2hpbGQoZUlucHV0KTtcclxuICAgIGVJbnB1dC5mb2N1cygpO1xyXG4gICAgZUlucHV0LnNlbGVjdCgpO1xyXG5cclxuICAgIHZhciBibHVyTGlzdGVuZXIgPSBmdW5jdGlvbigpIHtcclxuICAgICAgICB0aGF0LnN0b3BFZGl0aW5nKGVHcmlkQ2VsbCwgY29sRGVmLCBub2RlLCAkY2hpbGRTY29wZSwgZUlucHV0LCBibHVyTGlzdGVuZXIsIHJvd0luZGV4KTtcclxuICAgIH07XHJcblxyXG4gICAgLy9zdG9wIGVudGVyaW5nIGlmIHdlIGxvb3NlIGZvY3VzXHJcbiAgICBlSW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImJsdXJcIiwgYmx1ckxpc3RlbmVyKTtcclxuXHJcbiAgICAvL3N0b3AgZWRpdGluZyBpZiBlbnRlciBwcmVzc2VkXHJcbiAgICBlSW5wdXQuYWRkRXZlbnRMaXN0ZW5lcigna2V5cHJlc3MnLCBmdW5jdGlvbihldmVudCkge1xyXG4gICAgICAgIHZhciBrZXkgPSBldmVudC53aGljaCB8fCBldmVudC5rZXlDb2RlO1xyXG4gICAgICAgIC8vIDEzIGlzIGVudGVyXHJcbiAgICAgICAgaWYgKGtleSA9PSBFTlRFUl9LRVkpIHtcclxuICAgICAgICAgICAgdGhhdC5zdG9wRWRpdGluZyhlR3JpZENlbGwsIGNvbERlZiwgbm9kZSwgJGNoaWxkU2NvcGUsIGVJbnB1dCwgYmx1ckxpc3RlbmVyLCByb3dJbmRleCk7XHJcbiAgICAgICAgfVxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gdGFiIGtleSBkb2Vzbid0IGdlbmVyYXRlIGtleXByZXNzLCBzbyBuZWVkIGtleWRvd24gdG8gbGlzdGVuIGZvciB0aGF0XHJcbiAgICBlSW5wdXQuYWRkRXZlbnRMaXN0ZW5lcigna2V5ZG93bicsIGZ1bmN0aW9uKGV2ZW50KSB7XHJcbiAgICAgICAgdmFyIGtleSA9IGV2ZW50LndoaWNoIHx8IGV2ZW50LmtleUNvZGU7XHJcbiAgICAgICAgaWYgKGtleSA9PSBUQUJfS0VZKSB7XHJcbiAgICAgICAgICAgIHRoYXQuc3RvcEVkaXRpbmcoZUdyaWRDZWxsLCBjb2xEZWYsIG5vZGUsICRjaGlsZFNjb3BlLCBlSW5wdXQsIGJsdXJMaXN0ZW5lciwgcm93SW5kZXgpO1xyXG4gICAgICAgICAgICB0aGF0LnN0YXJ0RWRpdGluZ05leHRDZWxsKHJvd0luZGV4LCBjb2x1bW4sIGV2ZW50LnNoaWZ0S2V5KTtcclxuICAgICAgICAgICAgLy8gd2UgZG9uJ3Qgd2FudCB0aGUgZGVmYXVsdCB0YWIgYWN0aW9uLCBzbyByZXR1cm4gZmFsc2UsIHRoaXMgc3RvcHMgdGhlIGV2ZW50IGZyb20gYnViYmxpbmdcclxuICAgICAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgICAgIH1cclxuICAgIH0pO1xyXG59O1xyXG5cclxuUm93UmVuZGVyZXIucHJvdG90eXBlLnN0YXJ0RWRpdGluZ05leHRDZWxsID0gZnVuY3Rpb24ocm93SW5kZXgsIGNvbHVtbiwgc2hpZnRLZXkpIHtcclxuXHJcbiAgICB2YXIgZmlyc3RSb3dUb0NoZWNrID0gdGhpcy5maXJzdFZpcnR1YWxSZW5kZXJlZFJvdztcclxuICAgIHZhciBsYXN0Um93VG9DaGVjayA9IHRoaXMubGFzdFZpcnR1YWxSZW5kZXJlZFJvdztcclxuICAgIHZhciBjdXJyZW50Um93SW5kZXggPSByb3dJbmRleDtcclxuXHJcbiAgICB2YXIgdmlzaWJsZUNvbHVtbnMgPSB0aGlzLmNvbHVtbk1vZGVsLmdldFZpc2libGVDb2x1bW5zKCk7XHJcbiAgICB2YXIgY3VycmVudENvbCA9IGNvbHVtbjtcclxuXHJcbiAgICB3aGlsZSAodHJ1ZSkge1xyXG5cclxuICAgICAgICB2YXIgaW5kZXhPZkN1cnJlbnRDb2wgPSB2aXNpYmxlQ29sdW1ucy5pbmRleE9mKGN1cnJlbnRDb2wpO1xyXG5cclxuICAgICAgICAvLyBtb3ZlIGJhY2t3YXJkXHJcbiAgICAgICAgaWYgKHNoaWZ0S2V5KSB7XHJcbiAgICAgICAgICAgIC8vIG1vdmUgYWxvbmcgdG8gdGhlIHByZXZpb3VzIGNlbGxcclxuICAgICAgICAgICAgY3VycmVudENvbCA9IHZpc2libGVDb2x1bW5zW2luZGV4T2ZDdXJyZW50Q29sIC0gMV07XHJcbiAgICAgICAgICAgIC8vIGNoZWNrIGlmIGVuZCBvZiB0aGUgcm93LCBhbmQgaWYgc28sIGdvIGJhY2sgYSByb3dcclxuICAgICAgICAgICAgaWYgKCFjdXJyZW50Q29sKSB7XHJcbiAgICAgICAgICAgICAgICBjdXJyZW50Q29sID0gdmlzaWJsZUNvbHVtbnNbdmlzaWJsZUNvbHVtbnMubGVuZ3RoIC0gMV07XHJcbiAgICAgICAgICAgICAgICBjdXJyZW50Um93SW5kZXgtLTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgLy8gaWYgZ290IHRvIGVuZCBvZiByZW5kZXJlZCByb3dzLCB0aGVuIHF1aXQgbG9va2luZ1xyXG4gICAgICAgICAgICBpZiAoY3VycmVudFJvd0luZGV4IDwgZmlyc3RSb3dUb0NoZWNrKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgLy8gbW92ZSBmb3J3YXJkXHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgLy8gbW92ZSBhbG9uZyB0byB0aGUgbmV4dCBjZWxsXHJcbiAgICAgICAgICAgIGN1cnJlbnRDb2wgPSB2aXNpYmxlQ29sdW1uc1tpbmRleE9mQ3VycmVudENvbCArIDFdO1xyXG4gICAgICAgICAgICAvLyBjaGVjayBpZiBlbmQgb2YgdGhlIHJvdywgYW5kIGlmIHNvLCBnbyBmb3J3YXJkIGEgcm93XHJcbiAgICAgICAgICAgIGlmICghY3VycmVudENvbCkge1xyXG4gICAgICAgICAgICAgICAgY3VycmVudENvbCA9IHZpc2libGVDb2x1bW5zWzBdO1xyXG4gICAgICAgICAgICAgICAgY3VycmVudFJvd0luZGV4Kys7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIC8vIGlmIGdvdCB0byBlbmQgb2YgcmVuZGVyZWQgcm93cywgdGhlbiBxdWl0IGxvb2tpbmdcclxuICAgICAgICAgICAgaWYgKGN1cnJlbnRSb3dJbmRleCA+IGxhc3RSb3dUb0NoZWNrKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHZhciBuZXh0RnVuYyA9IHRoaXMucmVuZGVyZWRSb3dTdGFydEVkaXRpbmdMaXN0ZW5lcnNbY3VycmVudFJvd0luZGV4XVtjdXJyZW50Q29sLmNvbEtleV07XHJcbiAgICAgICAgaWYgKG5leHRGdW5jKSB7XHJcbiAgICAgICAgICAgIC8vIHNlZSBpZiB0aGUgbmV4dCBjZWxsIGlzIGVkaXRhYmxlLCBhbmQgaWYgc28sIHdlIGhhdmUgY29tZSB0b1xyXG4gICAgICAgICAgICAvLyB0aGUgZW5kIG9mIG91ciBzZWFyY2gsIHNvIHN0b3AgbG9va2luZyBmb3IgdGhlIG5leHQgY2VsbFxyXG4gICAgICAgICAgICB2YXIgbmV4dENlbGxBY2NlcHRlZEVkaXQgPSBuZXh0RnVuYygpO1xyXG4gICAgICAgICAgICBpZiAobmV4dENlbGxBY2NlcHRlZEVkaXQpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbn07XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IFJvd1JlbmRlcmVyO1xyXG4iLCJ2YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzJyk7XHJcblxyXG4vLyB0aGVzZSBjb25zdGFudHMgYXJlIHVzZWQgZm9yIGRldGVybWluaW5nIGlmIGdyb3VwcyBzaG91bGRcclxuLy8gYmUgc2VsZWN0ZWQgb3IgZGVzZWxlY3RlZCB3aGVuIHNlbGVjdGluZyBncm91cHMsIGFuZCB0aGUgZ3JvdXBcclxuLy8gdGhlbiBzZWxlY3RzIHRoZSBjaGlsZHJlbi5cclxudmFyIFNFTEVDVEVEID0gMDtcclxudmFyIFVOU0VMRUNURUQgPSAxO1xyXG52YXIgTUlYRUQgPSAyO1xyXG52YXIgRE9fTk9UX0NBUkUgPSAzO1xyXG5cclxuZnVuY3Rpb24gU2VsZWN0aW9uQ29udHJvbGxlcigpIHt9XHJcblxyXG5TZWxlY3Rpb25Db250cm9sbGVyLnByb3RvdHlwZS5pbml0ID0gZnVuY3Rpb24oYW5ndWxhckdyaWQsIGVSb3dzUGFyZW50LCBncmlkT3B0aW9uc1dyYXBwZXIsICRzY29wZSwgcm93UmVuZGVyZXIpIHtcclxuICAgIHRoaXMuZVJvd3NQYXJlbnQgPSBlUm93c1BhcmVudDtcclxuICAgIHRoaXMuYW5ndWxhckdyaWQgPSBhbmd1bGFyR3JpZDtcclxuICAgIHRoaXMuZ3JpZE9wdGlvbnNXcmFwcGVyID0gZ3JpZE9wdGlvbnNXcmFwcGVyO1xyXG4gICAgdGhpcy4kc2NvcGUgPSAkc2NvcGU7XHJcbiAgICB0aGlzLnJvd1JlbmRlcmVyID0gcm93UmVuZGVyZXI7XHJcblxyXG4gICAgdGhpcy5zZWxlY3RlZE5vZGVzQnlJZCA9IHt9O1xyXG4gICAgdGhpcy5zZWxlY3RlZFJvd3MgPSBbXTtcclxuXHJcbiAgICBncmlkT3B0aW9uc1dyYXBwZXIuc2V0U2VsZWN0ZWRSb3dzKHRoaXMuc2VsZWN0ZWRSb3dzKTtcclxuICAgIGdyaWRPcHRpb25zV3JhcHBlci5zZXRTZWxlY3RlZE5vZGVzQnlJZCh0aGlzLnNlbGVjdGVkTm9kZXNCeUlkKTtcclxufTtcclxuXHJcblNlbGVjdGlvbkNvbnRyb2xsZXIucHJvdG90eXBlLmdldFNlbGVjdGVkTm9kZXMgPSBmdW5jdGlvbigpIHtcclxuICAgIHZhciBzZWxlY3RlZE5vZGVzID0gW107XHJcbiAgICB2YXIga2V5cyA9IE9iamVjdC5rZXlzKHRoaXMuc2VsZWN0ZWROb2Rlc0J5SWQpO1xyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBrZXlzLmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgdmFyIGlkID0ga2V5c1tpXTtcclxuICAgICAgICB2YXIgc2VsZWN0ZWROb2RlID0gdGhpcy5zZWxlY3RlZE5vZGVzQnlJZFtpZF07XHJcbiAgICAgICAgc2VsZWN0ZWROb2Rlcy5wdXNoKHNlbGVjdGVkTm9kZSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gc2VsZWN0ZWROb2RlcztcclxufTtcclxuXHJcbi8vIHJldHVybnMgYSBsaXN0IG9mIGFsbCBub2RlcyBhdCAnYmVzdCBjb3N0JyAtIGEgZmVhdHVyZSB0byBiZSB1c2VkXHJcbi8vIHdpdGggZ3JvdXBzIC8gdHJlZXMuIGlmIGEgZ3JvdXAgaGFzIGFsbCBpdCdzIGNoaWxkcmVuIHNlbGVjdGVkLFxyXG4vLyB0aGVuIHRoZSBncm91cCBhcHBlYXJzIGluIHRoZSByZXN1bHQsIGJ1dCBub3QgdGhlIGNoaWxkcmVuLlxyXG4vLyBEZXNpZ25lZCBmb3IgdXNlIHdpdGggJ2NoaWxkcmVuJyBhcyB0aGUgZ3JvdXAgc2VsZWN0aW9uIHR5cGUsXHJcbi8vIHdoZXJlIGdyb3VwcyBkb24ndCBhY3R1YWxseSBhcHBlYXIgaW4gdGhlIHNlbGVjdGlvbiBub3JtYWxseS5cclxuU2VsZWN0aW9uQ29udHJvbGxlci5wcm90b3R5cGUuZ2V0QmVzdENvc3ROb2RlU2VsZWN0aW9uID0gZnVuY3Rpb24oKSB7XHJcblxyXG4gICAgdmFyIHRvcExldmVsTm9kZXMgPSB0aGlzLnJvd01vZGVsLmdldFRvcExldmVsTm9kZXMoKTtcclxuXHJcbiAgICB2YXIgcmVzdWx0ID0gW107XHJcbiAgICB2YXIgdGhhdCA9IHRoaXM7XHJcblxyXG4gICAgLy8gcmVjdXJzaXZlIGZ1bmN0aW9uLCB0byBmaW5kIHRoZSBzZWxlY3RlZCBub2Rlc1xyXG4gICAgZnVuY3Rpb24gdHJhdmVyc2Uobm9kZXMpIHtcclxuICAgICAgICBmb3IgKHZhciBpID0gMCwgbCA9IG5vZGVzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xyXG4gICAgICAgICAgICB2YXIgbm9kZSA9IG5vZGVzW2ldO1xyXG4gICAgICAgICAgICBpZiAodGhhdC5pc05vZGVTZWxlY3RlZChub2RlKSkge1xyXG4gICAgICAgICAgICAgICAgcmVzdWx0LnB1c2gobm9kZSk7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAvLyBpZiBub3Qgc2VsZWN0ZWQsIHRoZW4gaWYgaXQncyBhIGdyb3VwLCBhbmQgdGhlIGdyb3VwXHJcbiAgICAgICAgICAgICAgICAvLyBoYXMgY2hpbGRyZW4sIGNvbnRpbnVlIHRvIHNlYXJjaCBmb3Igc2VsZWN0aW9uc1xyXG4gICAgICAgICAgICAgICAgaWYgKG5vZGUuZ3JvdXAgJiYgbm9kZS5jaGlsZHJlbikge1xyXG4gICAgICAgICAgICAgICAgICAgIHRyYXZlcnNlKG5vZGUuY2hpbGRyZW4pO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHRyYXZlcnNlKHRvcExldmVsTm9kZXMpO1xyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5TZWxlY3Rpb25Db250cm9sbGVyLnByb3RvdHlwZS5zZXRSb3dNb2RlbCA9IGZ1bmN0aW9uKHJvd01vZGVsKSB7XHJcbiAgICB0aGlzLnJvd01vZGVsID0gcm93TW9kZWw7XHJcbn07XHJcblxyXG4vLyBwdWJsaWMgLSB0aGlzIGNsZWFycyB0aGUgc2VsZWN0aW9uLCBidXQgZG9lc24ndCBjbGVhciBkb3duIHRoZSBjc3MgLSB3aGVuIGl0IGlzIGNhbGxlZCwgdGhlXHJcbi8vIGNhbGxlciB0aGVuIGdldHMgdGhlIGdyaWQgdG8gcmVmcmVzaC5cclxuU2VsZWN0aW9uQ29udHJvbGxlci5wcm90b3R5cGUuY2xlYXJTZWxlY3Rpb24gPSBmdW5jdGlvbigpIHtcclxuICAgIHRoaXMuc2VsZWN0ZWRSb3dzLmxlbmd0aCA9IDA7XHJcbiAgICB2YXIga2V5cyA9IE9iamVjdC5rZXlzKHRoaXMuc2VsZWN0ZWROb2Rlc0J5SWQpO1xyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBrZXlzLmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgZGVsZXRlIHRoaXMuc2VsZWN0ZWROb2Rlc0J5SWRba2V5c1tpXV07XHJcbiAgICB9XHJcbn07XHJcblxyXG4vLyBwdWJsaWNcclxuU2VsZWN0aW9uQ29udHJvbGxlci5wcm90b3R5cGUuc2VsZWN0Tm9kZSA9IGZ1bmN0aW9uKG5vZGUsIHRyeU11bHRpLCBzdXBwcmVzc0V2ZW50cykge1xyXG4gICAgdmFyIG11bHRpU2VsZWN0ID0gdGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuaXNSb3dTZWxlY3Rpb25NdWx0aSgpICYmIHRyeU11bHRpO1xyXG5cclxuICAgIC8vIGlmIHRoZSBub2RlIGlzIGEgZ3JvdXAsIHRoZW4gc2VsZWN0aW5nIHRoaXMgaXMgdGhlIHNhbWUgYXMgc2VsZWN0aW5nIHRoZSBwYXJlbnQsXHJcbiAgICAvLyBzbyB0byBoYXZlIG9ubHkgb25lIGZsb3cgdGhyb3VnaCB0aGUgYmVsb3csIHdlIGFsd2F5cyBzZWxlY3QgdGhlIGhlYWRlciBwYXJlbnRcclxuICAgIC8vICh3aGljaCB0aGVuIGhhcyB0aGUgc2lkZSBlZmZlY3Qgb2Ygc2VsZWN0aW5nIHRoZSBjaGlsZCkuXHJcbiAgICB2YXIgbm9kZVRvU2VsZWN0O1xyXG4gICAgaWYgKG5vZGUuZm9vdGVyKSB7XHJcbiAgICAgICAgbm9kZVRvU2VsZWN0ID0gbm9kZS5zaWJsaW5nO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICBub2RlVG9TZWxlY3QgPSBub2RlO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIGF0IHRoZSBlbmQsIGlmIHRoaXMgaXMgdHJ1ZSwgd2UgaW5mb3JtIHRoZSBjYWxsYmFja1xyXG4gICAgdmFyIGF0TGVhc3RPbmVJdGVtVW5zZWxlY3RlZCA9IGZhbHNlO1xyXG4gICAgdmFyIGF0TGVhc3RPbmVJdGVtU2VsZWN0ZWQgPSBmYWxzZTtcclxuXHJcbiAgICAvLyBzZWUgaWYgcm93cyB0byBiZSBkZXNlbGVjdGVkXHJcbiAgICBpZiAoIW11bHRpU2VsZWN0KSB7XHJcbiAgICAgICAgYXRMZWFzdE9uZUl0ZW1VbnNlbGVjdGVkID0gdGhpcy5kb1dvcmtPZkRlc2VsZWN0QWxsTm9kZXMoKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAodGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuaXNHcm91cENoZWNrYm94U2VsZWN0aW9uQ2hpbGRyZW4oKSAmJiBub2RlVG9TZWxlY3QuZ3JvdXApIHtcclxuICAgICAgICAvLyBkb24ndCBzZWxlY3QgdGhlIGdyb3VwLCBzZWxlY3QgdGhlIGNoaWxkcmVuIGluc3RlYWRcclxuICAgICAgICBhdExlYXN0T25lSXRlbVNlbGVjdGVkID0gdGhpcy5yZWN1cnNpdmVseVNlbGVjdEFsbENoaWxkcmVuKG5vZGVUb1NlbGVjdCk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIC8vIHNlZSBpZiByb3cgbmVlZHMgdG8gYmUgc2VsZWN0ZWRcclxuICAgICAgICBhdExlYXN0T25lSXRlbVNlbGVjdGVkID0gdGhpcy5kb1dvcmtPZlNlbGVjdE5vZGUobm9kZVRvU2VsZWN0LCBzdXBwcmVzc0V2ZW50cyk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGF0TGVhc3RPbmVJdGVtVW5zZWxlY3RlZCB8fCBhdExlYXN0T25lSXRlbVNlbGVjdGVkKSB7XHJcbiAgICAgICAgdGhpcy5zeW5jU2VsZWN0ZWRSb3dzQW5kQ2FsbExpc3RlbmVyKHN1cHByZXNzRXZlbnRzKTtcclxuICAgIH1cclxuXHJcbiAgICB0aGlzLnVwZGF0ZUdyb3VwUGFyZW50c0lmTmVlZGVkKCk7XHJcbn07XHJcblxyXG5TZWxlY3Rpb25Db250cm9sbGVyLnByb3RvdHlwZS5yZWN1cnNpdmVseVNlbGVjdEFsbENoaWxkcmVuID0gZnVuY3Rpb24obm9kZSwgc3VwcHJlc3NFdmVudHMpIHtcclxuICAgIHZhciBhdExlYXN0T25lID0gZmFsc2U7XHJcbiAgICBpZiAobm9kZS5jaGlsZHJlbikge1xyXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbm9kZS5jaGlsZHJlbi5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgICAgICB2YXIgY2hpbGQgPSBub2RlLmNoaWxkcmVuW2ldO1xyXG4gICAgICAgICAgICBpZiAoY2hpbGQuZ3JvdXApIHtcclxuICAgICAgICAgICAgICAgIGlmICh0aGlzLnJlY3Vyc2l2ZWx5U2VsZWN0QWxsQ2hpbGRyZW4oY2hpbGQpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgYXRMZWFzdE9uZSA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5kb1dvcmtPZlNlbGVjdE5vZGUoY2hpbGQsIHN1cHByZXNzRXZlbnRzKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGF0TGVhc3RPbmUgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIGF0TGVhc3RPbmU7XHJcbn07XHJcblxyXG5TZWxlY3Rpb25Db250cm9sbGVyLnByb3RvdHlwZS5yZWN1cnNpdmVseURlc2VsZWN0QWxsQ2hpbGRyZW4gPSBmdW5jdGlvbihub2RlKSB7XHJcbiAgICBpZiAobm9kZS5jaGlsZHJlbikge1xyXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbm9kZS5jaGlsZHJlbi5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgICAgICB2YXIgY2hpbGQgPSBub2RlLmNoaWxkcmVuW2ldO1xyXG4gICAgICAgICAgICBpZiAoY2hpbGQuZ3JvdXApIHtcclxuICAgICAgICAgICAgICAgIHRoaXMucmVjdXJzaXZlbHlEZXNlbGVjdEFsbENoaWxkcmVuKGNoaWxkKTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuZGVzZWxlY3RSZWFsTm9kZShjaGlsZCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcbn07XHJcblxyXG4vLyBwcml2YXRlXHJcbi8vIDEgLSBzZWxlY3RzIGEgbm9kZVxyXG4vLyAyIC0gdXBkYXRlcyB0aGUgVUlcclxuLy8gMyAtIGNhbGxzIGNhbGxiYWNrc1xyXG5TZWxlY3Rpb25Db250cm9sbGVyLnByb3RvdHlwZS5kb1dvcmtPZlNlbGVjdE5vZGUgPSBmdW5jdGlvbihub2RlLCBzdXBwcmVzc0V2ZW50cykge1xyXG4gICAgaWYgKHRoaXMuc2VsZWN0ZWROb2Rlc0J5SWRbbm9kZS5pZF0pIHtcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5zZWxlY3RlZE5vZGVzQnlJZFtub2RlLmlkXSA9IG5vZGU7XHJcblxyXG4gICAgdGhpcy5hZGRDc3NDbGFzc0Zvck5vZGVfYW5kSW5mb3JtVmlydHVhbFJvd0xpc3RlbmVyKG5vZGUpO1xyXG5cclxuICAgIC8vIGFsc28gY29sb3IgaW4gdGhlIGZvb3RlciBpZiB0aGVyZSBpcyBvbmVcclxuICAgIGlmIChub2RlLmdyb3VwICYmIG5vZGUuZXhwYW5kZWQgJiYgbm9kZS5zaWJsaW5nKSB7XHJcbiAgICAgICAgdGhpcy5hZGRDc3NDbGFzc0Zvck5vZGVfYW5kSW5mb3JtVmlydHVhbFJvd0xpc3RlbmVyKG5vZGUuc2libGluZyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gaW5mb3JtIHRoZSByb3dTZWxlY3RlZCBsaXN0ZW5lciwgaWYgYW55XHJcbiAgICBpZiAoIXN1cHByZXNzRXZlbnRzICYmIHR5cGVvZiB0aGlzLmdyaWRPcHRpb25zV3JhcHBlci5nZXRSb3dTZWxlY3RlZCgpID09PSBcImZ1bmN0aW9uXCIpIHtcclxuICAgICAgICB0aGlzLmdyaWRPcHRpb25zV3JhcHBlci5nZXRSb3dTZWxlY3RlZCgpKG5vZGUuZGF0YSwgbm9kZSk7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHRydWU7XHJcbn07XHJcblxyXG4vLyBwcml2YXRlXHJcbi8vIDEgLSBzZWxlY3RzIGEgbm9kZVxyXG4vLyAyIC0gdXBkYXRlcyB0aGUgVUlcclxuLy8gMyAtIGNhbGxzIGNhbGxiYWNrc1xyXG4vLyB3b3cgLSB3aGF0IGEgYmlnIG5hbWUgZm9yIGEgbWV0aG9kLCBleGNlcHRpb24gY2FzZSwgaXQncyBzYXlpbmcgd2hhdCB0aGUgbWV0aG9kIGRvZXNcclxuU2VsZWN0aW9uQ29udHJvbGxlci5wcm90b3R5cGUuYWRkQ3NzQ2xhc3NGb3JOb2RlX2FuZEluZm9ybVZpcnR1YWxSb3dMaXN0ZW5lciA9IGZ1bmN0aW9uKG5vZGUpIHtcclxuICAgIHZhciB2aXJ0dWFsUmVuZGVyZWRSb3dJbmRleCA9IHRoaXMucm93UmVuZGVyZXIuZ2V0SW5kZXhPZlJlbmRlcmVkTm9kZShub2RlKTtcclxuICAgIGlmICh2aXJ0dWFsUmVuZGVyZWRSb3dJbmRleCA+PSAwKSB7XHJcbiAgICAgICAgdXRpbHMucXVlcnlTZWxlY3RvckFsbF9hZGRDc3NDbGFzcyh0aGlzLmVSb3dzUGFyZW50LCAnW3Jvdz1cIicgKyB2aXJ0dWFsUmVuZGVyZWRSb3dJbmRleCArICdcIl0nLCAnYWctcm93LXNlbGVjdGVkJyk7XHJcblxyXG4gICAgICAgIC8vIGluZm9ybSB2aXJ0dWFsIHJvdyBsaXN0ZW5lclxyXG4gICAgICAgIHRoaXMuYW5ndWxhckdyaWQub25WaXJ0dWFsUm93U2VsZWN0ZWQodmlydHVhbFJlbmRlcmVkUm93SW5kZXgsIHRydWUpO1xyXG4gICAgfVxyXG59O1xyXG5cclxuLy8gcHJpdmF0ZVxyXG4vLyAxIC0gdW4tc2VsZWN0cyBhIG5vZGVcclxuLy8gMiAtIHVwZGF0ZXMgdGhlIFVJXHJcbi8vIDMgLSBjYWxscyBjYWxsYmFja3NcclxuU2VsZWN0aW9uQ29udHJvbGxlci5wcm90b3R5cGUuZG9Xb3JrT2ZEZXNlbGVjdEFsbE5vZGVzID0gZnVuY3Rpb24obm9kZVRvS2VlcFNlbGVjdGVkKSB7XHJcbiAgICAvLyBub3QgZG9pbmcgbXVsdGktc2VsZWN0LCBzbyBkZXNlbGVjdCBldmVyeXRoaW5nIG90aGVyIHRoYW4gdGhlICdqdXN0IHNlbGVjdGVkJyByb3dcclxuICAgIHZhciBhdExlYXN0T25lU2VsZWN0aW9uQ2hhbmdlO1xyXG4gICAgdmFyIHNlbGVjdGVkTm9kZUtleXMgPSBPYmplY3Qua2V5cyh0aGlzLnNlbGVjdGVkTm9kZXNCeUlkKTtcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc2VsZWN0ZWROb2RlS2V5cy5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgIC8vIHNraXAgdGhlICdqdXN0IHNlbGVjdGVkJyByb3dcclxuICAgICAgICB2YXIga2V5ID0gc2VsZWN0ZWROb2RlS2V5c1tpXTtcclxuICAgICAgICB2YXIgbm9kZVRvRGVzZWxlY3QgPSB0aGlzLnNlbGVjdGVkTm9kZXNCeUlkW2tleV07XHJcbiAgICAgICAgaWYgKG5vZGVUb0Rlc2VsZWN0ID09PSBub2RlVG9LZWVwU2VsZWN0ZWQpIHtcclxuICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgdGhpcy5kZXNlbGVjdFJlYWxOb2RlKG5vZGVUb0Rlc2VsZWN0KTtcclxuICAgICAgICAgICAgYXRMZWFzdE9uZVNlbGVjdGlvbkNoYW5nZSA9IHRydWU7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIGF0TGVhc3RPbmVTZWxlY3Rpb25DaGFuZ2U7XHJcbn07XHJcblxyXG4vLyBwcml2YXRlXHJcblNlbGVjdGlvbkNvbnRyb2xsZXIucHJvdG90eXBlLmRlc2VsZWN0UmVhbE5vZGUgPSBmdW5jdGlvbihub2RlKSB7XHJcbiAgICAvLyBkZXNlbGVjdCB0aGUgY3NzXHJcbiAgICB0aGlzLnJlbW92ZUNzc0NsYXNzRm9yTm9kZShub2RlKTtcclxuXHJcbiAgICAvLyBpZiBub2RlIGlzIGEgaGVhZGVyLCBhbmQgaWYgaXQgaGFzIGEgc2libGluZyBmb290ZXIsIGRlc2VsZWN0IHRoZSBmb290ZXIgYWxzb1xyXG4gICAgaWYgKG5vZGUuZ3JvdXAgJiYgbm9kZS5leHBhbmRlZCAmJiBub2RlLnNpYmxpbmcpIHsgLy8gYWxzbyBjaGVjayB0aGF0IGl0J3MgZXhwYW5kZWQsIGFzIHNpYmxpbmcgY291bGQgYmUgYSBnaG9zdFxyXG4gICAgICAgIHRoaXMucmVtb3ZlQ3NzQ2xhc3NGb3JOb2RlKG5vZGUuc2libGluZyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gcmVtb3ZlIHRoZSByb3dcclxuICAgIGRlbGV0ZSB0aGlzLnNlbGVjdGVkTm9kZXNCeUlkW25vZGUuaWRdO1xyXG59O1xyXG5cclxuLy8gcHJpdmF0ZVxyXG5TZWxlY3Rpb25Db250cm9sbGVyLnByb3RvdHlwZS5yZW1vdmVDc3NDbGFzc0Zvck5vZGUgPSBmdW5jdGlvbihub2RlKSB7XHJcbiAgICB2YXIgdmlydHVhbFJlbmRlcmVkUm93SW5kZXggPSB0aGlzLnJvd1JlbmRlcmVyLmdldEluZGV4T2ZSZW5kZXJlZE5vZGUobm9kZSk7XHJcbiAgICBpZiAodmlydHVhbFJlbmRlcmVkUm93SW5kZXggPj0gMCkge1xyXG4gICAgICAgIHV0aWxzLnF1ZXJ5U2VsZWN0b3JBbGxfcmVtb3ZlQ3NzQ2xhc3ModGhpcy5lUm93c1BhcmVudCwgJ1tyb3c9XCInICsgdmlydHVhbFJlbmRlcmVkUm93SW5kZXggKyAnXCJdJywgJ2FnLXJvdy1zZWxlY3RlZCcpO1xyXG4gICAgICAgIC8vIGluZm9ybSB2aXJ0dWFsIHJvdyBsaXN0ZW5lclxyXG4gICAgICAgIHRoaXMuYW5ndWxhckdyaWQub25WaXJ0dWFsUm93U2VsZWN0ZWQodmlydHVhbFJlbmRlcmVkUm93SW5kZXgsIGZhbHNlKTtcclxuICAgIH1cclxufTtcclxuXHJcbi8vIHB1YmxpYyAoc2VsZWN0aW9uUmVuZGVyZXJGYWN0b3J5KVxyXG5TZWxlY3Rpb25Db250cm9sbGVyLnByb3RvdHlwZS5kZXNlbGVjdEluZGV4ID0gZnVuY3Rpb24ocm93SW5kZXgpIHtcclxuICAgIHZhciBub2RlID0gdGhpcy5yb3dNb2RlbC5nZXRWaXJ0dWFsUm93KHJvd0luZGV4KTtcclxuICAgIHRoaXMuZGVzZWxlY3ROb2RlKG5vZGUpO1xyXG59O1xyXG5cclxuLy8gcHVibGljIChhcGkpXHJcblNlbGVjdGlvbkNvbnRyb2xsZXIucHJvdG90eXBlLmRlc2VsZWN0Tm9kZSA9IGZ1bmN0aW9uKG5vZGUpIHtcclxuICAgIGlmIChub2RlKSB7XHJcbiAgICAgICAgaWYgKHRoaXMuZ3JpZE9wdGlvbnNXcmFwcGVyLmlzR3JvdXBDaGVja2JveFNlbGVjdGlvbkNoaWxkcmVuKCkgJiYgbm9kZS5ncm91cCkge1xyXG4gICAgICAgICAgICAvLyB3YW50IHRvIGRlc2VsZWN0IGNoaWxkcmVuLCBub3QgdGhpcyBub2RlLCBzbyByZWN1cnNpdmVseSBkZXNlbGVjdFxyXG4gICAgICAgICAgICB0aGlzLnJlY3Vyc2l2ZWx5RGVzZWxlY3RBbGxDaGlsZHJlbihub2RlKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICB0aGlzLmRlc2VsZWN0UmVhbE5vZGUobm9kZSk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgdGhpcy5zeW5jU2VsZWN0ZWRSb3dzQW5kQ2FsbExpc3RlbmVyKCk7XHJcbiAgICB0aGlzLnVwZGF0ZUdyb3VwUGFyZW50c0lmTmVlZGVkKCk7XHJcbn07XHJcblxyXG4vLyBwdWJsaWMgKHNlbGVjdGlvblJlbmRlcmVyRmFjdG9yeSAmIGFwaSlcclxuU2VsZWN0aW9uQ29udHJvbGxlci5wcm90b3R5cGUuc2VsZWN0SW5kZXggPSBmdW5jdGlvbihpbmRleCwgdHJ5TXVsdGksIHN1cHByZXNzRXZlbnRzKSB7XHJcbiAgICB2YXIgbm9kZSA9IHRoaXMucm93TW9kZWwuZ2V0VmlydHVhbFJvdyhpbmRleCk7XHJcbiAgICB0aGlzLnNlbGVjdE5vZGUobm9kZSwgdHJ5TXVsdGksIHN1cHByZXNzRXZlbnRzKTtcclxufTtcclxuXHJcbi8vIHByaXZhdGVcclxuLy8gdXBkYXRlcyB0aGUgc2VsZWN0ZWRSb3dzIHdpdGggdGhlIHNlbGVjdGVkTm9kZXMgYW5kIGNhbGxzIHNlbGVjdGlvbkNoYW5nZWQgbGlzdGVuZXJcclxuU2VsZWN0aW9uQ29udHJvbGxlci5wcm90b3R5cGUuc3luY1NlbGVjdGVkUm93c0FuZENhbGxMaXN0ZW5lciA9IGZ1bmN0aW9uKHN1cHByZXNzRXZlbnRzKSB7XHJcbiAgICAvLyB1cGRhdGUgc2VsZWN0ZWQgcm93c1xyXG4gICAgdmFyIHNlbGVjdGVkUm93cyA9IHRoaXMuc2VsZWN0ZWRSb3dzO1xyXG4gICAgLy8gY2xlYXIgc2VsZWN0ZWQgcm93c1xyXG4gICAgc2VsZWN0ZWRSb3dzLmxlbmd0aCA9IDA7XHJcbiAgICB2YXIga2V5cyA9IE9iamVjdC5rZXlzKHRoaXMuc2VsZWN0ZWROb2Rlc0J5SWQpO1xyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBrZXlzLmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgaWYgKHRoaXMuc2VsZWN0ZWROb2Rlc0J5SWRba2V5c1tpXV0gIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICB2YXIgc2VsZWN0ZWROb2RlID0gdGhpcy5zZWxlY3RlZE5vZGVzQnlJZFtrZXlzW2ldXTtcclxuICAgICAgICAgICAgc2VsZWN0ZWRSb3dzLnB1c2goc2VsZWN0ZWROb2RlLmRhdGEpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBpZiAoIXN1cHByZXNzRXZlbnRzICYmIHR5cGVvZiB0aGlzLmdyaWRPcHRpb25zV3JhcHBlci5nZXRTZWxlY3Rpb25DaGFuZ2VkKCkgPT09IFwiZnVuY3Rpb25cIikge1xyXG4gICAgICAgIHRoaXMuZ3JpZE9wdGlvbnNXcmFwcGVyLmdldFNlbGVjdGlvbkNoYW5nZWQoKSgpO1xyXG4gICAgfVxyXG5cclxuICAgIHZhciB0aGF0ID0gdGhpcztcclxuICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgdGhhdC4kc2NvcGUuJGFwcGx5KCk7XHJcbiAgICB9LCAwKTtcclxufTtcclxuXHJcbi8vIHByaXZhdGVcclxuU2VsZWN0aW9uQ29udHJvbGxlci5wcm90b3R5cGUucmVjdXJzaXZlbHlDaGVja0lmU2VsZWN0ZWQgPSBmdW5jdGlvbihub2RlKSB7XHJcbiAgICB2YXIgZm91bmRTZWxlY3RlZCA9IGZhbHNlO1xyXG4gICAgdmFyIGZvdW5kVW5zZWxlY3RlZCA9IGZhbHNlO1xyXG5cclxuICAgIGlmIChub2RlLmNoaWxkcmVuKSB7XHJcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBub2RlLmNoaWxkcmVuLmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgICAgIHZhciBjaGlsZCA9IG5vZGUuY2hpbGRyZW5baV07XHJcbiAgICAgICAgICAgIHZhciByZXN1bHQ7XHJcbiAgICAgICAgICAgIGlmIChjaGlsZC5ncm91cCkge1xyXG4gICAgICAgICAgICAgICAgcmVzdWx0ID0gdGhpcy5yZWN1cnNpdmVseUNoZWNrSWZTZWxlY3RlZChjaGlsZCk7XHJcbiAgICAgICAgICAgICAgICBzd2l0Y2ggKHJlc3VsdCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNhc2UgU0VMRUNURUQ6XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvdW5kU2VsZWN0ZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgICAgICAgICBjYXNlIFVOU0VMRUNURUQ6XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvdW5kVW5zZWxlY3RlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICAgICAgICAgIGNhc2UgTUlYRUQ6XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvdW5kU2VsZWN0ZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBmb3VuZFVuc2VsZWN0ZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gd2UgY2FuIGlnbm9yZSB0aGUgRE9fTk9UX0NBUkUsIGFzIGl0IGRvZXNuJ3QgaW1wYWN0LCBtZWFucyB0aGUgY2hpbGRcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gaGFzIG5vIGNoaWxkcmVuIGFuZCBzaG91bGRuJ3QgYmUgY29uc2lkZXJlZCB3aGVuIGRlY2lkaW5nXHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5pc05vZGVTZWxlY3RlZChjaGlsZCkpIHtcclxuICAgICAgICAgICAgICAgICAgICBmb3VuZFNlbGVjdGVkID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZm91bmRVbnNlbGVjdGVkID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgaWYgKGZvdW5kU2VsZWN0ZWQgJiYgZm91bmRVbnNlbGVjdGVkKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBpZiBtaXhlZCwgdGhlbiBubyBuZWVkIHRvIGdvIGZ1cnRoZXIsIGp1c3QgcmV0dXJuIHVwIHRoZSBjaGFpblxyXG4gICAgICAgICAgICAgICAgcmV0dXJuIE1JWEVEO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8vIGdvdCB0aGlzIGZhciwgc28gbm8gY29uZmxpY3RzLCBlaXRoZXIgYWxsIGNoaWxkcmVuIHNlbGVjdGVkLCB1bnNlbGVjdGVkLCBvciBuZWl0aGVyXHJcbiAgICBpZiAoZm91bmRTZWxlY3RlZCkge1xyXG4gICAgICAgIHJldHVybiBTRUxFQ1RFRDtcclxuICAgIH0gZWxzZSBpZiAoZm91bmRVbnNlbGVjdGVkKSB7XHJcbiAgICAgICAgcmV0dXJuIFVOU0VMRUNURUQ7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHJldHVybiBET19OT1RfQ0FSRTtcclxuICAgIH1cclxufTtcclxuXHJcbi8vIHB1YmxpYyAoc2VsZWN0aW9uUmVuZGVyZXJGYWN0b3J5KVxyXG4vLyByZXR1cm5zOlxyXG4vLyB0cnVlOiBpZiBzZWxlY3RlZFxyXG4vLyBmYWxzZTogaWYgdW5zZWxlY3RlZFxyXG4vLyB1bmRlZmluZWQ6IGlmIGl0J3MgYSBncm91cCBhbmQgJ2NoaWxkcmVuIHNlbGVjdGlvbicgaXMgdXNlZCBhbmQgJ2NoaWxkcmVuJyBhcmUgYSBtaXggb2Ygc2VsZWN0ZWQgYW5kIHVuc2VsZWN0ZWRcclxuU2VsZWN0aW9uQ29udHJvbGxlci5wcm90b3R5cGUuaXNOb2RlU2VsZWN0ZWQgPSBmdW5jdGlvbihub2RlKSB7XHJcbiAgICBpZiAodGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuaXNHcm91cENoZWNrYm94U2VsZWN0aW9uQ2hpbGRyZW4oKSAmJiBub2RlLmdyb3VwKSB7XHJcbiAgICAgICAgLy8gZG9pbmcgY2hpbGQgc2VsZWN0aW9uLCB3ZSBuZWVkIHRvIHRyYXZlcnNlIHRoZSBjaGlsZHJlblxyXG4gICAgICAgIHZhciByZXN1bHRPZkNoaWxkcmVuID0gdGhpcy5yZWN1cnNpdmVseUNoZWNrSWZTZWxlY3RlZChub2RlKTtcclxuICAgICAgICBzd2l0Y2ggKHJlc3VsdE9mQ2hpbGRyZW4pIHtcclxuICAgICAgICAgICAgY2FzZSBTRUxFQ1RFRDpcclxuICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgICAgICAgICBjYXNlIFVOU0VMRUNURUQ6XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICAgICAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG4gICAgICAgIH1cclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuc2VsZWN0ZWROb2Rlc0J5SWRbbm9kZS5pZF0gIT09IHVuZGVmaW5lZDtcclxuICAgIH1cclxufTtcclxuXHJcblNlbGVjdGlvbkNvbnRyb2xsZXIucHJvdG90eXBlLnVwZGF0ZUdyb3VwUGFyZW50c0lmTmVlZGVkID0gZnVuY3Rpb24oKSB7XHJcbiAgICAvLyB3ZSBvbmx5IGRvIHRoaXMgaWYgcGFyZW50IG5vZGVzIGFyZSByZXNwb25zaWJsZVxyXG4gICAgLy8gZm9yIHNlbGVjdGluZyB0aGVpciBjaGlsZHJlbi5cclxuICAgIGlmICghdGhpcy5ncmlkT3B0aW9uc1dyYXBwZXIuaXNHcm91cENoZWNrYm94U2VsZWN0aW9uQ2hpbGRyZW4oKSkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICB2YXIgZmlyc3RSb3cgPSB0aGlzLnJvd1JlbmRlcmVyLmdldEZpcnN0VmlydHVhbFJlbmRlcmVkUm93KCk7XHJcbiAgICB2YXIgbGFzdFJvdyA9IHRoaXMucm93UmVuZGVyZXIuZ2V0TGFzdFZpcnR1YWxSZW5kZXJlZFJvdygpO1xyXG4gICAgZm9yICh2YXIgcm93SW5kZXggPSBmaXJzdFJvdzsgcm93SW5kZXggPD0gbGFzdFJvdzsgcm93SW5kZXgrKykge1xyXG4gICAgICAgIC8vIHNlZSBpZiBub2RlIGlzIGEgZ3JvdXBcclxuICAgICAgICB2YXIgbm9kZSA9IHRoaXMucm93TW9kZWwuZ2V0VmlydHVhbFJvdyhyb3dJbmRleCk7XHJcbiAgICAgICAgaWYgKG5vZGUuZ3JvdXApIHtcclxuICAgICAgICAgICAgdmFyIHNlbGVjdGVkID0gdGhpcy5pc05vZGVTZWxlY3RlZChub2RlKTtcclxuICAgICAgICAgICAgdGhpcy5hbmd1bGFyR3JpZC5vblZpcnR1YWxSb3dTZWxlY3RlZChyb3dJbmRleCwgc2VsZWN0ZWQpO1xyXG5cclxuICAgICAgICAgICAgaWYgKHNlbGVjdGVkKSB7XHJcbiAgICAgICAgICAgICAgICB1dGlscy5xdWVyeVNlbGVjdG9yQWxsX2FkZENzc0NsYXNzKHRoaXMuZVJvd3NQYXJlbnQsICdbcm93PVwiJyArIHJvd0luZGV4ICsgJ1wiXScsICdhZy1yb3ctc2VsZWN0ZWQnKTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIHV0aWxzLnF1ZXJ5U2VsZWN0b3JBbGxfcmVtb3ZlQ3NzQ2xhc3ModGhpcy5lUm93c1BhcmVudCwgJ1tyb3c9XCInICsgcm93SW5kZXggKyAnXCJdJywgJ2FnLXJvdy1zZWxlY3RlZCcpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG59O1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBTZWxlY3Rpb25Db250cm9sbGVyO1xyXG4iLCJmdW5jdGlvbiBTZWxlY3Rpb25SZW5kZXJlckZhY3RvcnkoKSB7fVxyXG5cclxuU2VsZWN0aW9uUmVuZGVyZXJGYWN0b3J5LnByb3RvdHlwZS5pbml0ID0gZnVuY3Rpb24oYW5ndWxhckdyaWQsIHNlbGVjdGlvbkNvbnRyb2xsZXIpIHtcclxuICAgIHRoaXMuYW5ndWxhckdyaWQgPSBhbmd1bGFyR3JpZDtcclxuICAgIHRoaXMuc2VsZWN0aW9uQ29udHJvbGxlciA9IHNlbGVjdGlvbkNvbnRyb2xsZXI7XHJcbn07XHJcblxyXG5TZWxlY3Rpb25SZW5kZXJlckZhY3RvcnkucHJvdG90eXBlLmNyZWF0ZUNoZWNrYm94Q29sRGVmID0gZnVuY3Rpb24oKSB7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIHdpZHRoOiAzMCxcclxuICAgICAgICBzdXBwcmVzc01lbnU6IHRydWUsXHJcbiAgICAgICAgc3VwcHJlc3NTb3J0aW5nOiB0cnVlLFxyXG4gICAgICAgIGhlYWRlckNlbGxSZW5kZXJlcjogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHZhciBlQ2hlY2tib3ggPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdpbnB1dCcpO1xyXG4gICAgICAgICAgICBlQ2hlY2tib3gudHlwZSA9ICdjaGVja2JveCc7XHJcbiAgICAgICAgICAgIGVDaGVja2JveC5uYW1lID0gJ25hbWUnO1xyXG4gICAgICAgICAgICByZXR1cm4gZUNoZWNrYm94O1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgY2VsbFJlbmRlcmVyOiB0aGlzLmNyZWF0ZUNoZWNrYm94UmVuZGVyZXIoKVxyXG4gICAgfTtcclxufTtcclxuXHJcblNlbGVjdGlvblJlbmRlcmVyRmFjdG9yeS5wcm90b3R5cGUuY3JlYXRlQ2hlY2tib3hSZW5kZXJlciA9IGZ1bmN0aW9uKCkge1xyXG4gICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgcmV0dXJuIGZ1bmN0aW9uKHBhcmFtcykge1xyXG4gICAgICAgIHJldHVybiB0aGF0LmNyZWF0ZVNlbGVjdGlvbkNoZWNrYm94KHBhcmFtcy5ub2RlLCBwYXJhbXMucm93SW5kZXgpO1xyXG4gICAgfTtcclxufTtcclxuXHJcblNlbGVjdGlvblJlbmRlcmVyRmFjdG9yeS5wcm90b3R5cGUuY3JlYXRlU2VsZWN0aW9uQ2hlY2tib3ggPSBmdW5jdGlvbihub2RlLCByb3dJbmRleCkge1xyXG5cclxuICAgIHZhciBlQ2hlY2tib3ggPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdpbnB1dCcpO1xyXG4gICAgZUNoZWNrYm94LnR5cGUgPSBcImNoZWNrYm94XCI7XHJcbiAgICBlQ2hlY2tib3gubmFtZSA9IFwibmFtZVwiO1xyXG4gICAgZUNoZWNrYm94LmNsYXNzTmFtZSA9ICdhZy1zZWxlY3Rpb24tY2hlY2tib3gnO1xyXG4gICAgc2V0Q2hlY2tib3hTdGF0ZShlQ2hlY2tib3gsIHRoaXMuc2VsZWN0aW9uQ29udHJvbGxlci5pc05vZGVTZWxlY3RlZChub2RlKSk7XHJcblxyXG4gICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgZUNoZWNrYm94Lm9uY2xpY2sgPSBmdW5jdGlvbihldmVudCkge1xyXG4gICAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xyXG4gICAgfTtcclxuXHJcbiAgICBlQ2hlY2tib3gub25jaGFuZ2UgPSBmdW5jdGlvbigpIHtcclxuICAgICAgICB2YXIgbmV3VmFsdWUgPSBlQ2hlY2tib3guY2hlY2tlZDtcclxuICAgICAgICBpZiAobmV3VmFsdWUpIHtcclxuICAgICAgICAgICAgdGhhdC5zZWxlY3Rpb25Db250cm9sbGVyLnNlbGVjdEluZGV4KHJvd0luZGV4LCB0cnVlKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICB0aGF0LnNlbGVjdGlvbkNvbnRyb2xsZXIuZGVzZWxlY3RJbmRleChyb3dJbmRleCk7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuXHJcbiAgICB0aGlzLmFuZ3VsYXJHcmlkLmFkZFZpcnR1YWxSb3dMaXN0ZW5lcihyb3dJbmRleCwge1xyXG4gICAgICAgIHJvd1NlbGVjdGVkOiBmdW5jdGlvbihzZWxlY3RlZCkge1xyXG4gICAgICAgICAgICBzZXRDaGVja2JveFN0YXRlKGVDaGVja2JveCwgc2VsZWN0ZWQpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgcm93UmVtb3ZlZDogZnVuY3Rpb24oKSB7fVxyXG4gICAgfSk7XHJcblxyXG4gICAgcmV0dXJuIGVDaGVja2JveDtcclxufTtcclxuXHJcbmZ1bmN0aW9uIHNldENoZWNrYm94U3RhdGUoZUNoZWNrYm94LCBzdGF0ZSkge1xyXG4gICAgaWYgKHR5cGVvZiBzdGF0ZSA9PT0gJ2Jvb2xlYW4nKSB7XHJcbiAgICAgICAgZUNoZWNrYm94LmNoZWNrZWQgPSBzdGF0ZTtcclxuICAgICAgICBlQ2hlY2tib3guaW5kZXRlcm1pbmF0ZSA9IGZhbHNlO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICAvLyBpc05vZGVTZWxlY3RlZCByZXR1cm5zIGJhY2sgdW5kZWZpbmVkIGlmIGl0J3MgYSBncm91cCBhbmQgdGhlIGNoaWxkcmVuXHJcbiAgICAgICAgLy8gYXJlIGEgbWl4IG9mIHNlbGVjdGVkIGFuZCB1bnNlbGVjdGVkXHJcbiAgICAgICAgZUNoZWNrYm94LmluZGV0ZXJtaW5hdGUgPSB0cnVlO1xyXG4gICAgfVxyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IFNlbGVjdGlvblJlbmRlcmVyRmFjdG9yeTtcclxuIiwidmFyIFNWR19OUyA9IFwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIjtcclxuXHJcbmZ1bmN0aW9uIFN2Z0ZhY3RvcnkoKSB7fVxyXG5cclxuU3ZnRmFjdG9yeS5wcm90b3R5cGUuY3JlYXRlRmlsdGVyU3ZnID0gZnVuY3Rpb24oKSB7XHJcbiAgICB2YXIgZVN2ZyA9IGNyZWF0ZUljb25TdmcoKTtcclxuXHJcbiAgICB2YXIgZUZ1bm5lbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnROUyhTVkdfTlMsIFwicG9seWdvblwiKTtcclxuICAgIGVGdW5uZWwuc2V0QXR0cmlidXRlKFwicG9pbnRzXCIsIFwiMCwwIDQsNCA0LDEwIDYsMTAgNiw0IDEwLDBcIik7XHJcbiAgICBlRnVubmVsLnNldEF0dHJpYnV0ZShcImNsYXNzXCIsIFwiYWctaGVhZGVyLWljb25cIik7XHJcbiAgICBlU3ZnLmFwcGVuZENoaWxkKGVGdW5uZWwpO1xyXG5cclxuICAgIHJldHVybiBlU3ZnO1xyXG59O1xyXG5cclxuU3ZnRmFjdG9yeS5wcm90b3R5cGUuY3JlYXRlTWVudVN2ZyA9IGZ1bmN0aW9uKCkge1xyXG4gICAgdmFyIGVTdmcgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50TlMoU1ZHX05TLCBcInN2Z1wiKTtcclxuICAgIHZhciBzaXplID0gXCIxMlwiO1xyXG4gICAgZVN2Zy5zZXRBdHRyaWJ1dGUoXCJ3aWR0aFwiLCBzaXplKTtcclxuICAgIGVTdmcuc2V0QXR0cmlidXRlKFwiaGVpZ2h0XCIsIHNpemUpO1xyXG5cclxuICAgIFtcIjBcIiwgXCI1XCIsIFwiMTBcIl0uZm9yRWFjaChmdW5jdGlvbih5KSB7XHJcbiAgICAgICAgdmFyIGVMaW5lID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudE5TKFNWR19OUywgXCJyZWN0XCIpO1xyXG4gICAgICAgIGVMaW5lLnNldEF0dHJpYnV0ZShcInlcIiwgeSk7XHJcbiAgICAgICAgZUxpbmUuc2V0QXR0cmlidXRlKFwid2lkdGhcIiwgc2l6ZSk7XHJcbiAgICAgICAgZUxpbmUuc2V0QXR0cmlidXRlKFwiaGVpZ2h0XCIsIFwiMlwiKTtcclxuICAgICAgICBlTGluZS5zZXRBdHRyaWJ1dGUoXCJjbGFzc1wiLCBcImFnLWhlYWRlci1pY29uXCIpO1xyXG4gICAgICAgIGVTdmcuYXBwZW5kQ2hpbGQoZUxpbmUpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgcmV0dXJuIGVTdmc7XHJcbn07XHJcblxyXG5TdmdGYWN0b3J5LnByb3RvdHlwZS5jcmVhdGVBcnJvd1VwU3ZnID0gZnVuY3Rpb24oKSB7XHJcbiAgICByZXR1cm4gY3JlYXRlUG9seWdvblN2ZyhcIjAsMTAgNSwwIDEwLDEwXCIpO1xyXG59O1xyXG5cclxuU3ZnRmFjdG9yeS5wcm90b3R5cGUuY3JlYXRlQXJyb3dMZWZ0U3ZnID0gZnVuY3Rpb24oKSB7XHJcbiAgICByZXR1cm4gY3JlYXRlUG9seWdvblN2ZyhcIjEwLDAgMCw1IDEwLDEwXCIpO1xyXG59O1xyXG5cclxuU3ZnRmFjdG9yeS5wcm90b3R5cGUuY3JlYXRlQXJyb3dEb3duU3ZnID0gZnVuY3Rpb24oKSB7XHJcbiAgICByZXR1cm4gY3JlYXRlUG9seWdvblN2ZyhcIjAsMCA1LDEwIDEwLDBcIik7XHJcbn07XHJcblxyXG5TdmdGYWN0b3J5LnByb3RvdHlwZS5jcmVhdGVBcnJvd1JpZ2h0U3ZnID0gZnVuY3Rpb24oKSB7XHJcbiAgICByZXR1cm4gY3JlYXRlUG9seWdvblN2ZyhcIjAsMCAxMCw1IDAsMTBcIik7XHJcbn07XHJcblxyXG5mdW5jdGlvbiBjcmVhdGVQb2x5Z29uU3ZnKHBvaW50cykge1xyXG4gICAgdmFyIGVTdmcgPSBjcmVhdGVJY29uU3ZnKCk7XHJcblxyXG4gICAgdmFyIGVEZXNjSWNvbiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnROUyhTVkdfTlMsIFwicG9seWdvblwiKTtcclxuICAgIGVEZXNjSWNvbi5zZXRBdHRyaWJ1dGUoXCJwb2ludHNcIiwgcG9pbnRzKTtcclxuICAgIGVTdmcuYXBwZW5kQ2hpbGQoZURlc2NJY29uKTtcclxuXHJcbiAgICByZXR1cm4gZVN2ZztcclxufVxyXG5cclxuLy8gdXRpbCBmdW5jdGlvbiBmb3IgdGhlIGFib3ZlXHJcbmZ1bmN0aW9uIGNyZWF0ZUljb25TdmcoKSB7XHJcbiAgICB2YXIgZVN2ZyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnROUyhTVkdfTlMsIFwic3ZnXCIpO1xyXG4gICAgZVN2Zy5zZXRBdHRyaWJ1dGUoXCJ3aWR0aFwiLCBcIjEwXCIpO1xyXG4gICAgZVN2Zy5zZXRBdHRyaWJ1dGUoXCJoZWlnaHRcIiwgXCIxMFwiKTtcclxuICAgIHJldHVybiBlU3ZnO1xyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IFN2Z0ZhY3Rvcnk7XHJcbiIsInZhciB0ZW1wbGF0ZSA9IFtcclxuICAgICc8ZGl2IGNsYXNzPVwiYWctcm9vdCBhZy1zY3JvbGxzXCI+JyxcclxuICAgICcgICAgPCEtLSBUaGUgbG9hZGluZyBwYW5lbCAtLT4nLFxyXG4gICAgJyAgICA8IS0tIHdyYXBwaW5nIGluIG91dGVyIGRpdiwgYW5kIHdyYXBwZXIsIGlzIG5lZWRlZCB0byBjZW50ZXIgdGhlIGxvYWRpbmcgaWNvbiAtLT4nLFxyXG4gICAgJyAgICA8IS0tIFRoZSBpZGVhIGZvciBjZW50ZXJpbmcgY2FtZSBmcm9tIGhlcmU6IGh0dHA6Ly93d3cudmFuc2VvZGVzaWduLmNvbS9jc3MvdmVydGljYWwtY2VudGVyaW5nLyAtLT4nLFxyXG4gICAgJyAgICA8ZGl2IGNsYXNzPVwiYWctbG9hZGluZy1wYW5lbFwiPicsXHJcbiAgICAnICAgICAgICA8ZGl2IGNsYXNzPVwiYWctbG9hZGluZy13cmFwcGVyXCI+JyxcclxuICAgICcgICAgICAgICAgICA8c3BhbiBjbGFzcz1cImFnLWxvYWRpbmctY2VudGVyXCI+TG9hZGluZy4uLjwvc3Bhbj4nLFxyXG4gICAgJyAgICAgICAgPC9kaXY+JyxcclxuICAgICcgICAgPC9kaXY+JyxcclxuICAgICcgICAgPCEtLSBoZWFkZXIgLS0+JyxcclxuICAgICcgICAgPGRpdiBjbGFzcz1cImFnLWhlYWRlclwiPicsXHJcbiAgICAnICAgICAgICA8ZGl2IGNsYXNzPVwiYWctcGlubmVkLWhlYWRlclwiPjwvZGl2PjxkaXYgY2xhc3M9XCJhZy1oZWFkZXItdmlld3BvcnRcIj48ZGl2IGNsYXNzPVwiYWctaGVhZGVyLWNvbnRhaW5lclwiPjwvZGl2PjwvZGl2PicsXHJcbiAgICAnICAgIDwvZGl2PicsXHJcbiAgICAnICAgIDwhLS0gYm9keSAtLT4nLFxyXG4gICAgJyAgICA8ZGl2IGNsYXNzPVwiYWctYm9keVwiPicsXHJcbiAgICAnICAgICAgICA8ZGl2IGNsYXNzPVwiYWctcGlubmVkLWNvbHMtdmlld3BvcnRcIj4nLFxyXG4gICAgJyAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJhZy1waW5uZWQtY29scy1jb250YWluZXJcIj48L2Rpdj4nLFxyXG4gICAgJyAgICAgICAgPC9kaXY+JyxcclxuICAgICcgICAgICAgIDxkaXYgY2xhc3M9XCJhZy1ib2R5LXZpZXdwb3J0LXdyYXBwZXJcIj4nLFxyXG4gICAgJyAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJhZy1ib2R5LXZpZXdwb3J0XCI+JyxcclxuICAgICcgICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImFnLWJvZHktY29udGFpbmVyXCI+PC9kaXY+JyxcclxuICAgICcgICAgICAgICAgICA8L2Rpdj4nLFxyXG4gICAgJyAgICAgICAgPC9kaXY+JyxcclxuICAgICcgICAgPC9kaXY+JyxcclxuICAgICcgICAgPCEtLSBQYWdpbmcgLS0+JyxcclxuICAgICcgICAgPGRpdiBjbGFzcz1cImFnLXBhZ2luZy1wYW5lbFwiPicsXHJcbiAgICAnICAgIDwvZGl2PicsXHJcbiAgICAnICAgIDwvZGl2PidcclxuXS5qb2luKCcnKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gdGVtcGxhdGU7XHJcbiIsInZhciB0ZW1wbGF0ZSA9IFtcclxuICAgICc8ZGl2IGNsYXNzPVwiYWctcm9vdCBhZy1uby1zY3JvbGxzXCI+JyxcclxuICAgICcgICAgPCEtLSBTZWUgY29tbWVudCBpbiB0ZW1wbGF0ZS5odG1sIGZvciB3aHkgbG9hZGluZyBpcyBsYWlkIG91dCBsaWtlIHNvIC0tPicsXHJcbiAgICAnICAgIDxkaXYgY2xhc3M9XCJhZy1sb2FkaW5nLXBhbmVsXCI+JyxcclxuICAgICcgICAgICAgIDxkaXYgY2xhc3M9XCJhZy1sb2FkaW5nLXdyYXBwZXJcIj4nLFxyXG4gICAgJyAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwiYWctbG9hZGluZy1jZW50ZXJcIj5Mb2FkaW5nLi4uPC9zcGFuPicsXHJcbiAgICAnICAgICAgICA8L2Rpdj4nLFxyXG4gICAgJyAgICA8L2Rpdj4nLFxyXG4gICAgJyAgICA8IS0tIGhlYWRlciAtLT4nLFxyXG4gICAgJyAgICA8ZGl2IGNsYXNzPVwiYWctaGVhZGVyLWNvbnRhaW5lclwiPjwvZGl2PicsXHJcbiAgICAnICAgIDwhLS0gYm9keSAtLT4nLFxyXG4gICAgJyAgICA8ZGl2IGNsYXNzPVwiYWctYm9keS1jb250YWluZXJcIj48L2Rpdj4nLFxyXG4gICAgJzwvZGl2PidcclxuXS5qb2luKCcnKTtcclxuXHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IHRlbXBsYXRlO1xyXG4iLCJmdW5jdGlvbiBVdGlscygpIHt9XHJcblxyXG4vL1JldHVybnMgdHJ1ZSBpZiBpdCBpcyBhIERPTSBub2RlXHJcbi8vdGFrZW4gZnJvbTogaHR0cDovL3N0YWNrb3ZlcmZsb3cuY29tL3F1ZXN0aW9ucy8zODQyODYvamF2YXNjcmlwdC1pc2RvbS1ob3ctZG8teW91LWNoZWNrLWlmLWEtamF2YXNjcmlwdC1vYmplY3QtaXMtYS1kb20tb2JqZWN0XHJcblV0aWxzLnByb3RvdHlwZS5pc05vZGUgPSBmdW5jdGlvbihvKSB7XHJcbiAgICByZXR1cm4gKFxyXG4gICAgICAgIHR5cGVvZiBOb2RlID09PSBcIm9iamVjdFwiID8gbyBpbnN0YW5jZW9mIE5vZGUgOlxyXG4gICAgICAgIG8gJiYgdHlwZW9mIG8gPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIG8ubm9kZVR5cGUgPT09IFwibnVtYmVyXCIgJiYgdHlwZW9mIG8ubm9kZU5hbWUgPT09IFwic3RyaW5nXCJcclxuICAgICk7XHJcbn07XHJcblxyXG4vL1JldHVybnMgdHJ1ZSBpZiBpdCBpcyBhIERPTSBlbGVtZW50XHJcbi8vdGFrZW4gZnJvbTogaHR0cDovL3N0YWNrb3ZlcmZsb3cuY29tL3F1ZXN0aW9ucy8zODQyODYvamF2YXNjcmlwdC1pc2RvbS1ob3ctZG8teW91LWNoZWNrLWlmLWEtamF2YXNjcmlwdC1vYmplY3QtaXMtYS1kb20tb2JqZWN0XHJcblV0aWxzLnByb3RvdHlwZS5pc0VsZW1lbnQgPSBmdW5jdGlvbihvKSB7XHJcbiAgICByZXR1cm4gKFxyXG4gICAgICAgIHR5cGVvZiBIVE1MRWxlbWVudCA9PT0gXCJvYmplY3RcIiA/IG8gaW5zdGFuY2VvZiBIVE1MRWxlbWVudCA6IC8vRE9NMlxyXG4gICAgICAgIG8gJiYgdHlwZW9mIG8gPT09IFwib2JqZWN0XCIgJiYgbyAhPT0gbnVsbCAmJiBvLm5vZGVUeXBlID09PSAxICYmIHR5cGVvZiBvLm5vZGVOYW1lID09PSBcInN0cmluZ1wiXHJcbiAgICApO1xyXG59O1xyXG5cclxuVXRpbHMucHJvdG90eXBlLmlzTm9kZU9yRWxlbWVudCA9IGZ1bmN0aW9uKG8pIHtcclxuICAgIHJldHVybiB0aGlzLmlzTm9kZShvKSB8fCB0aGlzLmlzRWxlbWVudChvKTtcclxufTtcclxuXHJcbi8vYWRkcyBhbGwgdHlwZSBvZiBjaGFuZ2UgbGlzdGVuZXJzIHRvIGFuIGVsZW1lbnQsIGludGVuZGVkIHRvIGJlIGEgdGV4dCBmaWVsZFxyXG5VdGlscy5wcm90b3R5cGUuYWRkQ2hhbmdlTGlzdGVuZXIgPSBmdW5jdGlvbihlbGVtZW50LCBsaXN0ZW5lcikge1xyXG4gICAgZWxlbWVudC5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlZFwiLCBsaXN0ZW5lcik7XHJcbiAgICBlbGVtZW50LmFkZEV2ZW50TGlzdGVuZXIoXCJwYXN0ZVwiLCBsaXN0ZW5lcik7XHJcbiAgICBlbGVtZW50LmFkZEV2ZW50TGlzdGVuZXIoXCJpbnB1dFwiLCBsaXN0ZW5lcik7XHJcbn07XHJcblxyXG4vL2lmIHZhbHVlIGlzIHVuZGVmaW5lZCwgbnVsbCBvciBibGFuaywgcmV0dXJucyBudWxsLCBvdGhlcndpc2UgcmV0dXJucyB0aGUgdmFsdWVcclxuVXRpbHMucHJvdG90eXBlLm1ha2VOdWxsID0gZnVuY3Rpb24odmFsdWUpIHtcclxuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlID09PSBcIlwiKSB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHJldHVybiB2YWx1ZTtcclxuICAgIH1cclxufTtcclxuXHJcblV0aWxzLnByb3RvdHlwZS5yZW1vdmVBbGxDaGlsZHJlbiA9IGZ1bmN0aW9uKG5vZGUpIHtcclxuICAgIGlmIChub2RlKSB7XHJcbiAgICAgICAgd2hpbGUgKG5vZGUuaGFzQ2hpbGROb2RlcygpKSB7XHJcbiAgICAgICAgICAgIG5vZGUucmVtb3ZlQ2hpbGQobm9kZS5sYXN0Q2hpbGQpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxufTtcclxuXHJcbi8vYWRkcyBhbiBlbGVtZW50IHRvIGEgZGl2LCBidXQgYWxzbyBhZGRzIGEgYmFja2dyb3VuZCBjaGVja2luZyBmb3IgY2xpY2tzLFxyXG4vL3NvIHRoYXQgd2hlbiB0aGUgYmFja2dyb3VuZCBpcyBjbGlja2VkLCB0aGUgY2hpbGQgaXMgcmVtb3ZlZCBhZ2FpbiwgZ2l2aW5nXHJcbi8vYSBtb2RlbCBsb29rIHRvIHBvcHVwcy5cclxuVXRpbHMucHJvdG90eXBlLmFkZEFzTW9kYWxQb3B1cCA9IGZ1bmN0aW9uKGVQYXJlbnQsIGVDaGlsZCkge1xyXG4gICAgdmFyIGVCYWNrZHJvcCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgICBlQmFja2Ryb3AuY2xhc3NOYW1lID0gXCJhZy1wb3B1cC1iYWNrZHJvcFwiO1xyXG5cclxuICAgIGVCYWNrZHJvcC5vbmNsaWNrID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgZVBhcmVudC5yZW1vdmVDaGlsZChlQ2hpbGQpO1xyXG4gICAgICAgIGVQYXJlbnQucmVtb3ZlQ2hpbGQoZUJhY2tkcm9wKTtcclxuICAgIH07XHJcblxyXG4gICAgZVBhcmVudC5hcHBlbmRDaGlsZChlQmFja2Ryb3ApO1xyXG4gICAgZVBhcmVudC5hcHBlbmRDaGlsZChlQ2hpbGQpO1xyXG59O1xyXG5cclxuLy9sb2FkcyB0aGUgdGVtcGxhdGUgYW5kIHJldHVybnMgaXQgYXMgYW4gZWxlbWVudC4gbWFrZXMgdXAgZm9yIG5vIHNpbXBsZSB3YXkgaW5cclxuLy90aGUgZG9tIGFwaSB0byBsb2FkIGh0bWwgZGlyZWN0bHksIGVnIHdlIGNhbm5vdCBkbyB0aGlzOiBkb2N1bWVudC5jcmVhdGVFbGVtZW50KHRlbXBsYXRlKVxyXG5VdGlscy5wcm90b3R5cGUubG9hZFRlbXBsYXRlID0gZnVuY3Rpb24odGVtcGxhdGUpIHtcclxuICAgIHZhciB0ZW1wRGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcclxuICAgIHRlbXBEaXYuaW5uZXJIVE1MID0gdGVtcGxhdGU7XHJcbiAgICByZXR1cm4gdGVtcERpdi5maXJzdENoaWxkO1xyXG59O1xyXG5cclxuLy9pZiBwYXNzZWQgJzQycHgnIHRoZW4gcmV0dXJucyB0aGUgbnVtYmVyIDQyXHJcblV0aWxzLnByb3RvdHlwZS5waXhlbFN0cmluZ1RvTnVtYmVyID0gZnVuY3Rpb24odmFsKSB7XHJcbiAgICBpZiAodHlwZW9mIHZhbCA9PT0gXCJzdHJpbmdcIikge1xyXG4gICAgICAgIGlmICh2YWwuaW5kZXhPZihcInB4XCIpID49IDApIHtcclxuICAgICAgICAgICAgdmFsLnJlcGxhY2UoXCJweFwiLCBcIlwiKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIHBhcnNlSW50KHZhbCk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHJldHVybiB2YWw7XHJcbiAgICB9XHJcbn07XHJcblxyXG5VdGlscy5wcm90b3R5cGUucXVlcnlTZWxlY3RvckFsbF9hZGRDc3NDbGFzcyA9IGZ1bmN0aW9uKGVQYXJlbnQsIHNlbGVjdG9yLCBjc3NDbGFzcykge1xyXG4gICAgdmFyIGVSb3dzID0gZVBhcmVudC5xdWVyeVNlbGVjdG9yQWxsKHNlbGVjdG9yKTtcclxuICAgIGZvciAodmFyIGsgPSAwOyBrIDwgZVJvd3MubGVuZ3RoOyBrKyspIHtcclxuICAgICAgICB0aGlzLmFkZENzc0NsYXNzKGVSb3dzW2tdLCBjc3NDbGFzcyk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5VdGlscy5wcm90b3R5cGUucXVlcnlTZWxlY3RvckFsbF9yZW1vdmVDc3NDbGFzcyA9IGZ1bmN0aW9uKGVQYXJlbnQsIHNlbGVjdG9yLCBjc3NDbGFzcykge1xyXG4gICAgdmFyIGVSb3dzID0gZVBhcmVudC5xdWVyeVNlbGVjdG9yQWxsKHNlbGVjdG9yKTtcclxuICAgIGZvciAodmFyIGsgPSAwOyBrIDwgZVJvd3MubGVuZ3RoOyBrKyspIHtcclxuICAgICAgICB0aGlzLnJlbW92ZUNzc0NsYXNzKGVSb3dzW2tdLCBjc3NDbGFzcyk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5VdGlscy5wcm90b3R5cGUuYWRkQ3NzQ2xhc3MgPSBmdW5jdGlvbihlbGVtZW50LCBjbGFzc05hbWUpIHtcclxuICAgIHZhciBvbGRDbGFzc2VzID0gZWxlbWVudC5jbGFzc05hbWU7XHJcbiAgICBpZiAob2xkQ2xhc3Nlcykge1xyXG4gICAgICAgIGlmIChvbGRDbGFzc2VzLmluZGV4T2YoY2xhc3NOYW1lKSA+PSAwKSB7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgZWxlbWVudC5jbGFzc05hbWUgPSBvbGRDbGFzc2VzICsgXCIgXCIgKyBjbGFzc05hbWU7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIGVsZW1lbnQuY2xhc3NOYW1lID0gY2xhc3NOYW1lO1xyXG4gICAgfVxyXG59O1xyXG5cclxuVXRpbHMucHJvdG90eXBlLnJlbW92ZUNzc0NsYXNzID0gZnVuY3Rpb24oZWxlbWVudCwgY2xhc3NOYW1lKSB7XHJcbiAgICB2YXIgb2xkQ2xhc3NlcyA9IGVsZW1lbnQuY2xhc3NOYW1lO1xyXG4gICAgaWYgKG9sZENsYXNzZXMuaW5kZXhPZihjbGFzc05hbWUpIDwgMCkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIHZhciBuZXdDbGFzc2VzID0gb2xkQ2xhc3Nlcy5yZXBsYWNlKFwiIFwiICsgY2xhc3NOYW1lLCBcIlwiKTtcclxuICAgIG5ld0NsYXNzZXMgPSBuZXdDbGFzc2VzLnJlcGxhY2UoY2xhc3NOYW1lICsgXCIgXCIsIFwiXCIpO1xyXG4gICAgaWYgKG5ld0NsYXNzZXMgPT0gY2xhc3NOYW1lKSB7XHJcbiAgICAgICAgbmV3Q2xhc3NlcyA9IFwiXCI7XHJcbiAgICB9XHJcbiAgICBlbGVtZW50LmNsYXNzTmFtZSA9IG5ld0NsYXNzZXM7XHJcbn07XHJcblxyXG5VdGlscy5wcm90b3R5cGUucmVtb3ZlRnJvbUFycmF5ID0gZnVuY3Rpb24oYXJyYXksIG9iamVjdCkge1xyXG4gICAgYXJyYXkuc3BsaWNlKGFycmF5LmluZGV4T2Yob2JqZWN0KSwgMSk7XHJcbn07XHJcblxyXG5VdGlscy5wcm90b3R5cGUuZGVmYXVsdENvbXBhcmF0b3IgPSBmdW5jdGlvbih2YWx1ZUEsIHZhbHVlQikge1xyXG4gICAgdmFyIHZhbHVlQU1pc3NpbmcgPSB2YWx1ZUEgPT09IG51bGwgfHwgdmFsdWVBID09PSB1bmRlZmluZWQ7XHJcbiAgICB2YXIgdmFsdWVCTWlzc2luZyA9IHZhbHVlQiA9PT0gbnVsbCB8fCB2YWx1ZUIgPT09IHVuZGVmaW5lZDtcclxuICAgIGlmICh2YWx1ZUFNaXNzaW5nICYmIHZhbHVlQk1pc3NpbmcpIHtcclxuICAgICAgICByZXR1cm4gMDtcclxuICAgIH1cclxuICAgIGlmICh2YWx1ZUFNaXNzaW5nKSB7XHJcbiAgICAgICAgcmV0dXJuIC0xO1xyXG4gICAgfVxyXG4gICAgaWYgKHZhbHVlQk1pc3NpbmcpIHtcclxuICAgICAgICByZXR1cm4gMTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAodmFsdWVBIDwgdmFsdWVCKSB7XHJcbiAgICAgICAgcmV0dXJuIC0xO1xyXG4gICAgfSBlbHNlIGlmICh2YWx1ZUEgPiB2YWx1ZUIpIHtcclxuICAgICAgICByZXR1cm4gMTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgcmV0dXJuIDA7XHJcbiAgICB9XHJcbn07XHJcblxyXG5VdGlscy5wcm90b3R5cGUuZm9ybWF0V2lkdGggPSBmdW5jdGlvbih3aWR0aCkge1xyXG4gICAgaWYgKHR5cGVvZiB3aWR0aCA9PT0gXCJudW1iZXJcIikge1xyXG4gICAgICAgIHJldHVybiB3aWR0aCArIFwicHhcIjtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgcmV0dXJuIHdpZHRoO1xyXG4gICAgfVxyXG59O1xyXG5cclxuLy8gdHJpZXMgdG8gdXNlIHRoZSBwcm92aWRlZCByZW5kZXJlci4gaWYgYSByZW5kZXJlciBmb3VuZCwgcmV0dXJucyB0cnVlLlxyXG4vLyBpZiBubyByZW5kZXJlciwgcmV0dXJucyBmYWxzZS5cclxuVXRpbHMucHJvdG90eXBlLnVzZVJlbmRlcmVyID0gZnVuY3Rpb24oZVBhcmVudCwgZVJlbmRlcmVyLCBwYXJhbXMpIHtcclxuICAgIHZhciByZXN1bHRGcm9tUmVuZGVyZXIgPSBlUmVuZGVyZXIocGFyYW1zKTtcclxuICAgIGlmICh0aGlzLmlzTm9kZShyZXN1bHRGcm9tUmVuZGVyZXIpIHx8IHRoaXMuaXNFbGVtZW50KHJlc3VsdEZyb21SZW5kZXJlcikpIHtcclxuICAgICAgICAvL2EgZG9tIG5vZGUgb3IgZWxlbWVudCB3YXMgcmV0dXJuZWQsIHNvIGFkZCBjaGlsZFxyXG4gICAgICAgIGVQYXJlbnQuYXBwZW5kQ2hpbGQocmVzdWx0RnJvbVJlbmRlcmVyKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgLy9vdGhlcndpc2UgYXNzdW1lIGl0IHdhcyBodG1sLCBzbyBqdXN0IGluc2VydFxyXG4gICAgICAgIHZhciBlVGV4dFNwYW4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzcGFuJyk7XHJcbiAgICAgICAgZVRleHRTcGFuLmlubmVySFRNTCA9IHJlc3VsdEZyb21SZW5kZXJlcjtcclxuICAgICAgICBlUGFyZW50LmFwcGVuZENoaWxkKGVUZXh0U3Bhbik7XHJcbiAgICB9XHJcbn07XHJcblxyXG4vLyBpZiBpY29uIHByb3ZpZGVkLCB1c2UgdGhpcyAoZWl0aGVyIGEgc3RyaW5nLCBvciBhIGZ1bmN0aW9uIGNhbGxiYWNrKS5cclxuLy8gaWYgbm90LCB0aGVuIHVzZSB0aGUgc2Vjb25kIHBhcmFtZXRlciwgd2hpY2ggaXMgdGhlIHN2Z0ZhY3RvcnkgZnVuY3Rpb25cclxuVXRpbHMucHJvdG90eXBlLmNyZWF0ZUljb24gPSBmdW5jdGlvbihpY29uTmFtZSwgZ3JpZE9wdGlvbnNXcmFwcGVyLCBjb2xEZWZXcmFwcGVyLCBzdmdGYWN0b3J5RnVuYykge1xyXG4gICAgdmFyIGVSZXN1bHQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzcGFuJyk7XHJcbiAgICB2YXIgdXNlclByb3ZpZGVkSWNvbjtcclxuICAgIC8vIGNoZWNrIGNvbCBmb3IgaWNvbiBmaXJzdFxyXG4gICAgaWYgKGNvbERlZldyYXBwZXIgJiYgY29sRGVmV3JhcHBlci5jb2xEZWYuaWNvbnMpIHtcclxuICAgICAgICB1c2VyUHJvdmlkZWRJY29uID0gY29sRGVmV3JhcHBlci5jb2xEZWYuaWNvbnNbaWNvbk5hbWVdO1xyXG4gICAgfVxyXG4gICAgLy8gaXQgbm90IGluIGNvbCwgdHJ5IGdyaWQgb3B0aW9uc1xyXG4gICAgaWYgKCF1c2VyUHJvdmlkZWRJY29uICYmIGdyaWRPcHRpb25zV3JhcHBlci5nZXRJY29ucygpKSB7XHJcbiAgICAgICAgdXNlclByb3ZpZGVkSWNvbiA9IGdyaWRPcHRpb25zV3JhcHBlci5nZXRJY29ucygpW2ljb25OYW1lXTtcclxuICAgIH1cclxuICAgIC8vIG5vdyBpZiB1c2VyIHByb3ZpZGVkLCB1c2UgaXRcclxuICAgIGlmICh1c2VyUHJvdmlkZWRJY29uKSB7XHJcbiAgICAgICAgdmFyIHJlbmRlcmVyUmVzdWx0O1xyXG4gICAgICAgIGlmICh0eXBlb2YgdXNlclByb3ZpZGVkSWNvbiA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICAgICAgICByZW5kZXJlclJlc3VsdCA9IHVzZXJQcm92aWRlZEljb24oKTtcclxuICAgICAgICB9IGVsc2UgaWYgKHR5cGVvZiB1c2VyUHJvdmlkZWRJY29uID09PSAnc3RyaW5nJykge1xyXG4gICAgICAgICAgICByZW5kZXJlclJlc3VsdCA9IHVzZXJQcm92aWRlZEljb247XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2ljb24gZnJvbSBncmlkIG9wdGlvbnMgbmVlZHMgdG8gYmUgYSBzdHJpbmcgb3IgYSBmdW5jdGlvbic7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmICh0eXBlb2YgcmVuZGVyZXJSZXN1bHQgPT09ICdzdHJpbmcnKSB7XHJcbiAgICAgICAgICAgIGVSZXN1bHQuaW5uZXJIVE1MID0gcmVuZGVyZXJSZXN1bHQ7XHJcbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLmlzTm9kZU9yRWxlbWVudChyZW5kZXJlclJlc3VsdCkpIHtcclxuICAgICAgICAgICAgZVJlc3VsdC5hcHBlbmRDaGlsZChyZW5kZXJlclJlc3VsdCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2ljb25SZW5kZXJlciBzaG91bGQgcmV0dXJuIGJhY2sgYSBzdHJpbmcgb3IgYSBkb20gb2JqZWN0JztcclxuICAgICAgICB9XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIC8vIG90aGVyd2lzZSB3ZSB1c2UgdGhlIGJ1aWx0IGluIGljb25cclxuICAgICAgICBlUmVzdWx0LmFwcGVuZENoaWxkKHN2Z0ZhY3RvcnlGdW5jKCkpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGVSZXN1bHQ7XHJcbn07XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IG5ldyBVdGlscygpO1xyXG4iLCIvKlxyXG4gKiBUaGlzIHJvdyBjb250cm9sbGVyIGlzIHVzZWQgZm9yIGluZmluaXRlIHNjcm9sbGluZyBvbmx5LiBGb3Igbm9ybWFsICdpbiBtZW1vcnknIHRhYmxlLFxyXG4gKiBvciBzdGFuZGFyZCBwYWdpbmF0aW9uLCB0aGUgaW5NZW1vcnlSb3dDb250cm9sbGVyIGlzIHVzZWQuXHJcbiAqL1xyXG5cclxudmFyIGxvZ2dpbmcgPSB0cnVlO1xyXG5cclxuZnVuY3Rpb24gVmlydHVhbFBhZ2VSb3dDb250cm9sbGVyKCkge31cclxuXHJcblZpcnR1YWxQYWdlUm93Q29udHJvbGxlci5wcm90b3R5cGUuaW5pdCA9IGZ1bmN0aW9uKHJvd1JlbmRlcmVyKSB7XHJcbiAgICB0aGlzLnJvd1JlbmRlcmVyID0gcm93UmVuZGVyZXI7XHJcbiAgICB0aGlzLmRhdGFzb3VyY2VWZXJzaW9uID0gMDtcclxufTtcclxuXHJcblZpcnR1YWxQYWdlUm93Q29udHJvbGxlci5wcm90b3R5cGUuc2V0RGF0YXNvdXJjZSA9IGZ1bmN0aW9uKGRhdGFzb3VyY2UpIHtcclxuICAgIHRoaXMuZGF0YXNvdXJjZSA9IGRhdGFzb3VyY2U7XHJcblxyXG4gICAgaWYgKCFkYXRhc291cmNlKSB7XHJcbiAgICAgICAgLy8gb25seSBjb250aW51ZSBpZiB3ZSBoYXZlIGEgdmFsaWQgZGF0YXNvdXJjZSB0byB3b3JraW5nIHdpdGhcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5yZXNldCgpO1xyXG59O1xyXG5cclxuVmlydHVhbFBhZ2VSb3dDb250cm9sbGVyLnByb3RvdHlwZS5yZXNldCA9IGZ1bmN0aW9uKCkge1xyXG4gICAgLy8gc2VlIGlmIGRhdGFzb3VyY2Uga25vd3MgaG93IG1hbnkgcm93cyB0aGVyZSBhcmVcclxuICAgIGlmICh0eXBlb2YgdGhpcy5kYXRhc291cmNlLnJvd0NvdW50ID09PSAnbnVtYmVyJyAmJiB0aGlzLmRhdGFzb3VyY2Uucm93Q291bnQgPj0gMCkge1xyXG4gICAgICAgIHRoaXMudmlydHVhbFJvd0NvdW50ID0gdGhpcy5kYXRhc291cmNlLnJvd0NvdW50O1xyXG4gICAgICAgIHRoaXMuZm91bmRNYXhSb3cgPSB0cnVlO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICB0aGlzLnZpcnR1YWxSb3dDb3VudCA9IDA7XHJcbiAgICAgICAgdGhpcy5mb3VuZE1heFJvdyA9IGZhbHNlO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIGluIGNhc2UgYW55IGRhZW1vbiByZXF1ZXN0cyBjb21pbmcgZnJvbSBkYXRhc291cmNlLCB3ZSBrbm93IGl0IGlnbm9yZSB0aGVtXHJcbiAgICB0aGlzLmRhdGFzb3VyY2VWZXJzaW9uKys7XHJcblxyXG4gICAgLy8gbWFwIG9mIHBhZ2UgbnVtYmVycyB0byByb3dzIGluIHRoYXQgcGFnZVxyXG4gICAgdGhpcy5wYWdlQ2FjaGUgPSB7fTtcclxuICAgIHRoaXMucGFnZUNhY2hlU2l6ZSA9IDA7XHJcblxyXG4gICAgLy8gaWYgYSBudW1iZXIgaXMgaW4gdGhpcyBhcnJheSwgaXQgbWVhbnMgd2UgYXJlIHBlbmRpbmcgYSBsb2FkIGZyb20gaXRcclxuICAgIHRoaXMucGFnZUxvYWRzSW5Qcm9ncmVzcyA9IFtdO1xyXG4gICAgdGhpcy5wYWdlTG9hZHNRdWV1ZWQgPSBbXTtcclxuICAgIHRoaXMucGFnZUFjY2Vzc1RpbWVzID0ge307IC8vIGtlZXBzIGEgcmVjb3JkIG9mIHdoZW4gZWFjaCBwYWdlIHdhcyBsYXN0IHZpZXdlZCwgdXNlZCBmb3IgTFJVIGNhY2hlXHJcbiAgICB0aGlzLmFjY2Vzc1RpbWUgPSAwOyAvLyByYXRoZXIgdGhhbiB1c2luZyB0aGUgY2xvY2ssIHdlIHVzZSB0aGlzIGNvdW50ZXJcclxuXHJcbiAgICAvLyB0aGUgbnVtYmVyIG9mIGNvbmN1cnJlbnQgbG9hZHMgd2UgYXJlIGFsbG93ZWQgdG8gdGhlIHNlcnZlclxyXG4gICAgaWYgKHR5cGVvZiB0aGlzLmRhdGFzb3VyY2UubWF4Q29uY3VycmVudFJlcXVlc3RzID09PSAnbnVtYmVyJyAmJiB0aGlzLmRhdGFzb3VyY2UubWF4Q29uY3VycmVudFJlcXVlc3RzID4gMCkge1xyXG4gICAgICAgIHRoaXMubWF4Q29uY3VycmVudERhdGFzb3VyY2VSZXF1ZXN0cyA9IHRoaXMuZGF0YXNvdXJjZS5tYXhDb25jdXJyZW50UmVxdWVzdHM7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHRoaXMubWF4Q29uY3VycmVudERhdGFzb3VyY2VSZXF1ZXN0cyA9IDI7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gdGhlIG51bWJlciBvZiBwYWdlcyB0byBrZWVwIGluIGJyb3dzZXIgY2FjaGVcclxuICAgIGlmICh0eXBlb2YgdGhpcy5kYXRhc291cmNlLm1heFBhZ2VzSW5DYWNoZSA9PT0gJ251bWJlcicgJiYgdGhpcy5kYXRhc291cmNlLm1heFBhZ2VzSW5DYWNoZSA+IDApIHtcclxuICAgICAgICB0aGlzLm1heFBhZ2VzSW5DYWNoZSA9IHRoaXMuZGF0YXNvdXJjZS5tYXhQYWdlc0luQ2FjaGU7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIC8vIG51bGwgaXMgZGVmYXVsdCwgbWVhbnMgZG9uJ3QgIGhhdmUgYW55IG1heCBzaXplIG9uIHRoZSBjYWNoZVxyXG4gICAgICAgIHRoaXMubWF4UGFnZXNJbkNhY2hlID0gbnVsbDtcclxuICAgIH1cclxuXHJcbiAgICB0aGlzLnBhZ2VTaXplID0gdGhpcy5kYXRhc291cmNlLnBhZ2VTaXplOyAvLyB0YWtlIGEgY29weSBvZiBwYWdlIHNpemUsIHdlIGRvbid0IHdhbnQgaXQgY2hhbmdpbmdcclxuICAgIHRoaXMub3ZlcmZsb3dTaXplID0gdGhpcy5kYXRhc291cmNlLm92ZXJmbG93U2l6ZTsgLy8gdGFrZSBhIGNvcHkgb2YgcGFnZSBzaXplLCB3ZSBkb24ndCB3YW50IGl0IGNoYW5naW5nXHJcblxyXG4gICAgdGhpcy5kb0xvYWRPclF1ZXVlKDApO1xyXG59O1xyXG5cclxuVmlydHVhbFBhZ2VSb3dDb250cm9sbGVyLnByb3RvdHlwZS5jcmVhdGVOb2Rlc0Zyb21Sb3dzID0gZnVuY3Rpb24ocGFnZU51bWJlciwgcm93cykge1xyXG4gICAgdmFyIG5vZGVzID0gW107XHJcbiAgICBpZiAocm93cykge1xyXG4gICAgICAgIGZvciAodmFyIGkgPSAwLCBqID0gcm93cy5sZW5ndGg7IGkgPCBqOyBpKyspIHtcclxuICAgICAgICAgICAgdmFyIHZpcnR1YWxSb3dJbmRleCA9IChwYWdlTnVtYmVyICogdGhpcy5wYWdlU2l6ZSkgKyBpO1xyXG4gICAgICAgICAgICBub2Rlcy5wdXNoKHtcclxuICAgICAgICAgICAgICAgIGRhdGE6IHJvd3NbaV0sXHJcbiAgICAgICAgICAgICAgICBpZDogdmlydHVhbFJvd0luZGV4XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIHJldHVybiBub2RlcztcclxufTtcclxuXHJcblZpcnR1YWxQYWdlUm93Q29udHJvbGxlci5wcm90b3R5cGUucmVtb3ZlRnJvbUxvYWRpbmcgPSBmdW5jdGlvbihwYWdlTnVtYmVyKSB7XHJcbiAgICB2YXIgaW5kZXggPSB0aGlzLnBhZ2VMb2Fkc0luUHJvZ3Jlc3MuaW5kZXhPZihwYWdlTnVtYmVyKTtcclxuICAgIHRoaXMucGFnZUxvYWRzSW5Qcm9ncmVzcy5zcGxpY2UoaW5kZXgsIDEpO1xyXG59O1xyXG5cclxuVmlydHVhbFBhZ2VSb3dDb250cm9sbGVyLnByb3RvdHlwZS5wYWdlTG9hZEZhaWxlZCA9IGZ1bmN0aW9uKHBhZ2VOdW1iZXIpIHtcclxuICAgIHRoaXMucmVtb3ZlRnJvbUxvYWRpbmcocGFnZU51bWJlcik7XHJcbiAgICB0aGlzLmNoZWNrUXVldWVGb3JOZXh0TG9hZCgpO1xyXG59O1xyXG5cclxuVmlydHVhbFBhZ2VSb3dDb250cm9sbGVyLnByb3RvdHlwZS5wYWdlTG9hZGVkID0gZnVuY3Rpb24ocGFnZU51bWJlciwgcm93cywgbGFzdFJvdykge1xyXG4gICAgdGhpcy5wdXRQYWdlSW50b0NhY2hlQW5kUHVyZ2UocGFnZU51bWJlciwgcm93cyk7XHJcbiAgICB0aGlzLmNoZWNrTWF4Um93QW5kSW5mb3JtUm93UmVuZGVyZXIocGFnZU51bWJlciwgbGFzdFJvdyk7XHJcbiAgICB0aGlzLnJlbW92ZUZyb21Mb2FkaW5nKHBhZ2VOdW1iZXIpO1xyXG4gICAgdGhpcy5jaGVja1F1ZXVlRm9yTmV4dExvYWQoKTtcclxufTtcclxuXHJcblZpcnR1YWxQYWdlUm93Q29udHJvbGxlci5wcm90b3R5cGUucHV0UGFnZUludG9DYWNoZUFuZFB1cmdlID0gZnVuY3Rpb24ocGFnZU51bWJlciwgcm93cykge1xyXG4gICAgdGhpcy5wYWdlQ2FjaGVbcGFnZU51bWJlcl0gPSB0aGlzLmNyZWF0ZU5vZGVzRnJvbVJvd3MocGFnZU51bWJlciwgcm93cyk7XHJcbiAgICB0aGlzLnBhZ2VDYWNoZVNpemUrKztcclxuICAgIGlmIChsb2dnaW5nKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ2FkZGluZyBwYWdlICcgKyBwYWdlTnVtYmVyKTtcclxuICAgIH1cclxuXHJcbiAgICB2YXIgbmVlZFRvUHVyZ2UgPSB0aGlzLm1heFBhZ2VzSW5DYWNoZSAmJiB0aGlzLm1heFBhZ2VzSW5DYWNoZSA8IHRoaXMucGFnZUNhY2hlU2l6ZTtcclxuICAgIGlmIChuZWVkVG9QdXJnZSkge1xyXG4gICAgICAgIC8vIGZpbmQgdGhlIExSVSBwYWdlXHJcbiAgICAgICAgdmFyIHlvdW5nZXN0UGFnZUluZGV4ID0gdGhpcy5maW5kTGVhc3RSZWNlbnRseUFjY2Vzc2VkUGFnZShPYmplY3Qua2V5cyh0aGlzLnBhZ2VDYWNoZSkpO1xyXG5cclxuICAgICAgICBpZiAobG9nZ2luZykge1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygncHVyZ2luZyBwYWdlICcgKyB5b3VuZ2VzdFBhZ2VJbmRleCArICcgZnJvbSBjYWNoZSAnICsgT2JqZWN0LmtleXModGhpcy5wYWdlQ2FjaGUpKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgZGVsZXRlIHRoaXMucGFnZUNhY2hlW3lvdW5nZXN0UGFnZUluZGV4XTtcclxuICAgICAgICB0aGlzLnBhZ2VDYWNoZVNpemUtLTtcclxuICAgIH1cclxuXHJcbn07XHJcblxyXG5WaXJ0dWFsUGFnZVJvd0NvbnRyb2xsZXIucHJvdG90eXBlLmNoZWNrTWF4Um93QW5kSW5mb3JtUm93UmVuZGVyZXIgPSBmdW5jdGlvbihwYWdlTnVtYmVyLCBsYXN0Um93KSB7XHJcbiAgICBpZiAoIXRoaXMuZm91bmRNYXhSb3cpIHtcclxuICAgICAgICAvLyBpZiB3ZSBrbm93IHRoZSBsYXN0IHJvdywgdXNlIGlmXHJcbiAgICAgICAgaWYgKHR5cGVvZiBsYXN0Um93ID09PSAnbnVtYmVyJyAmJiBsYXN0Um93ID49IDApIHtcclxuICAgICAgICAgICAgdGhpcy52aXJ0dWFsUm93Q291bnQgPSBsYXN0Um93O1xyXG4gICAgICAgICAgICB0aGlzLmZvdW5kTWF4Um93ID0gdHJ1ZTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAvLyBvdGhlcndpc2UsIHNlZSBpZiB3ZSBuZWVkIHRvIGFkZCBzb21lIHZpcnR1YWwgcm93c1xyXG4gICAgICAgICAgICB2YXIgdGhpc1BhZ2VQbHVzQnVmZmVyID0gKChwYWdlTnVtYmVyICsgMSkgKiB0aGlzLnBhZ2VTaXplKSArIHRoaXMub3ZlcmZsb3dTaXplO1xyXG4gICAgICAgICAgICBpZiAodGhpcy52aXJ0dWFsUm93Q291bnQgPCB0aGlzUGFnZVBsdXNCdWZmZXIpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMudmlydHVhbFJvd0NvdW50ID0gdGhpc1BhZ2VQbHVzQnVmZmVyO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIC8vIGlmIHJvd0NvdW50IGNoYW5nZXMsIHJlZnJlc2hWaWV3LCBvdGhlcndpc2UganVzdCByZWZyZXNoQWxsVmlydHVhbFJvd3NcclxuICAgICAgICB0aGlzLnJvd1JlbmRlcmVyLnJlZnJlc2hWaWV3KCk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHRoaXMucm93UmVuZGVyZXIucmVmcmVzaEFsbFZpcnR1YWxSb3dzKCk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5WaXJ0dWFsUGFnZVJvd0NvbnRyb2xsZXIucHJvdG90eXBlLmlzUGFnZUFscmVhZHlMb2FkaW5nID0gZnVuY3Rpb24ocGFnZU51bWJlcikge1xyXG4gICAgdmFyIHJlc3VsdCA9IHRoaXMucGFnZUxvYWRzSW5Qcm9ncmVzcy5pbmRleE9mKHBhZ2VOdW1iZXIpID49IDAgfHwgdGhpcy5wYWdlTG9hZHNRdWV1ZWQuaW5kZXhPZihwYWdlTnVtYmVyKSA+PSAwO1xyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufTtcclxuXHJcblZpcnR1YWxQYWdlUm93Q29udHJvbGxlci5wcm90b3R5cGUuZG9Mb2FkT3JRdWV1ZSA9IGZ1bmN0aW9uKHBhZ2VOdW1iZXIpIHtcclxuICAgIC8vIGlmIHdlIGFscmVhZHkgdHJpZWQgdG8gbG9hZCB0aGlzIHBhZ2UsIHRoZW4gaWdub3JlIHRoZSByZXF1ZXN0LFxyXG4gICAgLy8gb3RoZXJ3aXNlIHNlcnZlciB3b3VsZCBiZSBoaXQgNTAgdGltZXMganVzdCB0byBkaXNwbGF5IG9uZSBwYWdlLCB0aGVcclxuICAgIC8vIGZpcnN0IHJvdyB0byBmaW5kIHRoZSBwYWdlIG1pc3NpbmcgaXMgZW5vdWdoLlxyXG4gICAgaWYgKHRoaXMuaXNQYWdlQWxyZWFkeUxvYWRpbmcocGFnZU51bWJlcikpIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgLy8gdHJ5IHRoZSBwYWdlIGxvYWQgLSBpZiBub3QgYWxyZWFkeSBkb2luZyBhIGxvYWQsIHRoZW4gd2UgY2FuIGdvIGFoZWFkXHJcbiAgICBpZiAodGhpcy5wYWdlTG9hZHNJblByb2dyZXNzLmxlbmd0aCA8IHRoaXMubWF4Q29uY3VycmVudERhdGFzb3VyY2VSZXF1ZXN0cykge1xyXG4gICAgICAgIC8vIGdvIGFoZWFkLCBsb2FkIHRoZSBwYWdlXHJcbiAgICAgICAgdGhpcy5sb2FkUGFnZShwYWdlTnVtYmVyKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgLy8gb3RoZXJ3aXNlLCBxdWV1ZSB0aGUgcmVxdWVzdFxyXG4gICAgICAgIHRoaXMuYWRkVG9RdWV1ZUFuZFB1cmdlUXVldWUocGFnZU51bWJlcik7XHJcbiAgICB9XHJcbn07XHJcblxyXG5WaXJ0dWFsUGFnZVJvd0NvbnRyb2xsZXIucHJvdG90eXBlLmFkZFRvUXVldWVBbmRQdXJnZVF1ZXVlID0gZnVuY3Rpb24ocGFnZU51bWJlcikge1xyXG4gICAgaWYgKGxvZ2dpbmcpIHtcclxuICAgICAgICBjb25zb2xlLmxvZygncXVldWVpbmcgJyArIHBhZ2VOdW1iZXIgKyAnIC0gJyArIHRoaXMucGFnZUxvYWRzUXVldWVkKTtcclxuICAgIH1cclxuICAgIHRoaXMucGFnZUxvYWRzUXVldWVkLnB1c2gocGFnZU51bWJlcik7XHJcblxyXG4gICAgLy8gc2VlIGlmIHRoZXJlIGFyZSBtb3JlIHBhZ2VzIHF1ZXVlZCB0aGF0IGFyZSBhY3R1YWxseSBpbiBvdXIgY2FjaGUsIGlmIHNvIHRoZXJlIGlzXHJcbiAgICAvLyBubyBwb2ludCBpbiBsb2FkaW5nIHRoZW0gYWxsIGFzIHNvbWUgd2lsbCBiZSBwdXJnZWQgYXMgc29vbiBhcyBsb2FkZWRcclxuICAgIHZhciBuZWVkVG9QdXJnZSA9IHRoaXMubWF4UGFnZXNJbkNhY2hlICYmIHRoaXMubWF4UGFnZXNJbkNhY2hlIDwgdGhpcy5wYWdlTG9hZHNRdWV1ZWQubGVuZ3RoO1xyXG4gICAgaWYgKG5lZWRUb1B1cmdlKSB7XHJcbiAgICAgICAgLy8gZmluZCB0aGUgTFJVIHBhZ2VcclxuICAgICAgICB2YXIgeW91bmdlc3RQYWdlSW5kZXggPSB0aGlzLmZpbmRMZWFzdFJlY2VudGx5QWNjZXNzZWRQYWdlKHRoaXMucGFnZUxvYWRzUXVldWVkKTtcclxuXHJcbiAgICAgICAgaWYgKGxvZ2dpbmcpIHtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coJ2RlLXF1ZXVlaW5nICcgKyBwYWdlTnVtYmVyICsgJyAtICcgKyB0aGlzLnBhZ2VMb2Fkc1F1ZXVlZCk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICB2YXIgaW5kZXhUb1JlbW92ZSA9IHRoaXMucGFnZUxvYWRzUXVldWVkLmluZGV4T2YoeW91bmdlc3RQYWdlSW5kZXgpO1xyXG4gICAgICAgIHRoaXMucGFnZUxvYWRzUXVldWVkLnNwbGljZShpbmRleFRvUmVtb3ZlLCAxKTtcclxuICAgIH1cclxufTtcclxuXHJcblZpcnR1YWxQYWdlUm93Q29udHJvbGxlci5wcm90b3R5cGUuZmluZExlYXN0UmVjZW50bHlBY2Nlc3NlZFBhZ2UgPSBmdW5jdGlvbihwYWdlSW5kZXhlcykge1xyXG4gICAgdmFyIHlvdW5nZXN0UGFnZUluZGV4ID0gLTE7XHJcbiAgICB2YXIgeW91bmdlc3RQYWdlQWNjZXNzVGltZSA9IE51bWJlci5NQVhfVkFMVUU7XHJcbiAgICB2YXIgdGhhdCA9IHRoaXM7XHJcblxyXG4gICAgcGFnZUluZGV4ZXMuZm9yRWFjaChmdW5jdGlvbihwYWdlSW5kZXgpIHtcclxuICAgICAgICB2YXIgYWNjZXNzVGltZVRoaXNQYWdlID0gdGhhdC5wYWdlQWNjZXNzVGltZXNbcGFnZUluZGV4XTtcclxuICAgICAgICBpZiAoYWNjZXNzVGltZVRoaXNQYWdlIDwgeW91bmdlc3RQYWdlQWNjZXNzVGltZSkge1xyXG4gICAgICAgICAgICB5b3VuZ2VzdFBhZ2VBY2Nlc3NUaW1lID0gYWNjZXNzVGltZVRoaXNQYWdlO1xyXG4gICAgICAgICAgICB5b3VuZ2VzdFBhZ2VJbmRleCA9IHBhZ2VJbmRleDtcclxuICAgICAgICB9XHJcbiAgICB9KTtcclxuXHJcbiAgICByZXR1cm4geW91bmdlc3RQYWdlSW5kZXg7XHJcbn07XHJcblxyXG5WaXJ0dWFsUGFnZVJvd0NvbnRyb2xsZXIucHJvdG90eXBlLmNoZWNrUXVldWVGb3JOZXh0TG9hZCA9IGZ1bmN0aW9uKCkge1xyXG4gICAgaWYgKHRoaXMucGFnZUxvYWRzUXVldWVkLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAvLyB0YWtlIGZyb20gdGhlIGZyb250IG9mIHRoZSBxdWV1ZVxyXG4gICAgICAgIHZhciBwYWdlVG9Mb2FkID0gdGhpcy5wYWdlTG9hZHNRdWV1ZWRbMF07XHJcbiAgICAgICAgdGhpcy5wYWdlTG9hZHNRdWV1ZWQuc3BsaWNlKDAsIDEpO1xyXG5cclxuICAgICAgICBpZiAobG9nZ2luZykge1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnZGVxdWV1ZWluZyAnICsgcGFnZVRvTG9hZCArICcgLSAnICsgdGhpcy5wYWdlTG9hZHNRdWV1ZWQpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdGhpcy5sb2FkUGFnZShwYWdlVG9Mb2FkKTtcclxuICAgIH1cclxufTtcclxuXHJcblZpcnR1YWxQYWdlUm93Q29udHJvbGxlci5wcm90b3R5cGUubG9hZFBhZ2UgPSBmdW5jdGlvbihwYWdlTnVtYmVyKSB7XHJcblxyXG4gICAgdGhpcy5wYWdlTG9hZHNJblByb2dyZXNzLnB1c2gocGFnZU51bWJlcik7XHJcblxyXG4gICAgdmFyIHN0YXJ0Um93ID0gcGFnZU51bWJlciAqIHRoaXMucGFnZVNpemU7XHJcbiAgICB2YXIgZW5kUm93ID0gKHBhZ2VOdW1iZXIgKyAxKSAqIHRoaXMucGFnZVNpemU7XHJcblxyXG4gICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgdmFyIGRhdGFzb3VyY2VWZXJzaW9uQ29weSA9IHRoaXMuZGF0YXNvdXJjZVZlcnNpb247XHJcblxyXG4gICAgdGhpcy5kYXRhc291cmNlLmdldFJvd3Moc3RhcnRSb3csIGVuZFJvdyxcclxuICAgICAgICBmdW5jdGlvbiBzdWNjZXNzKHJvd3MsIGxhc3RSb3cpIHtcclxuICAgICAgICAgICAgaWYgKHRoYXQucmVxdWVzdElzRGFlbW9uKGRhdGFzb3VyY2VWZXJzaW9uQ29weSkpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB0aGF0LnBhZ2VMb2FkZWQocGFnZU51bWJlciwgcm93cywgbGFzdFJvdyk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBmdW5jdGlvbiBmYWlsKCkge1xyXG4gICAgICAgICAgICBpZiAodGhhdC5yZXF1ZXN0SXNEYWVtb24oZGF0YXNvdXJjZVZlcnNpb25Db3B5KSkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHRoYXQucGFnZUxvYWRGYWlsZWQocGFnZU51bWJlcik7XHJcbiAgICAgICAgfVxyXG4gICAgKTtcclxufTtcclxuXHJcbi8vIGNoZWNrIHRoYXQgdGhlIGRhdGFzb3VyY2UgaGFzIG5vdCBjaGFuZ2VkIHNpbmNlIHRoZSBsYXRzIHRpbWUgd2UgZGlkIGEgcmVxdWVzdFxyXG5WaXJ0dWFsUGFnZVJvd0NvbnRyb2xsZXIucHJvdG90eXBlLnJlcXVlc3RJc0RhZW1vbiA9IGZ1bmN0aW9uKGRhdGFzb3VyY2VWZXJzaW9uQ29weSkge1xyXG4gICAgcmV0dXJuIHRoaXMuZGF0YXNvdXJjZVZlcnNpb24gIT09IGRhdGFzb3VyY2VWZXJzaW9uQ29weTtcclxufTtcclxuXHJcblZpcnR1YWxQYWdlUm93Q29udHJvbGxlci5wcm90b3R5cGUuZ2V0VmlydHVhbFJvdyA9IGZ1bmN0aW9uKHJvd0luZGV4KSB7XHJcbiAgICBpZiAocm93SW5kZXggPiB0aGlzLnZpcnR1YWxSb3dDb3VudCkge1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIHZhciBwYWdlTnVtYmVyID0gTWF0aC5mbG9vcihyb3dJbmRleCAvIHRoaXMucGFnZVNpemUpO1xyXG4gICAgdmFyIHBhZ2UgPSB0aGlzLnBhZ2VDYWNoZVtwYWdlTnVtYmVyXTtcclxuXHJcbiAgICAvLyBmb3IgTFJVIGNhY2hlLCB0cmFjayB3aGVuIHRoaXMgcGFnZSB3YXMgbGFzdCBoaXRcclxuICAgIHRoaXMucGFnZUFjY2Vzc1RpbWVzW3BhZ2VOdW1iZXJdID0gdGhpcy5hY2Nlc3NUaW1lKys7XHJcblxyXG4gICAgaWYgKCFwYWdlKSB7XHJcbiAgICAgICAgdGhpcy5kb0xvYWRPclF1ZXVlKHBhZ2VOdW1iZXIpO1xyXG4gICAgICAgIC8vIHJldHVybiBiYWNrIGFuIGVtcHR5IHJvdywgc28gdGFibGUgY2FuIGF0IGxlYXN0IHJlbmRlciBlbXB0eSBjZWxsc1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgIGRhdGE6IHt9LFxyXG4gICAgICAgICAgICBpZDogcm93SW5kZXhcclxuICAgICAgICB9O1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICB2YXIgaW5kZXhJblRoaXNQYWdlID0gcm93SW5kZXggJSB0aGlzLnBhZ2VTaXplO1xyXG4gICAgICAgIHJldHVybiBwYWdlW2luZGV4SW5UaGlzUGFnZV07XHJcbiAgICB9XHJcbn07XHJcblxyXG5WaXJ0dWFsUGFnZVJvd0NvbnRyb2xsZXIucHJvdG90eXBlLmdldE1vZGVsID0gZnVuY3Rpb24oKSB7XHJcbiAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIGdldFZpcnR1YWxSb3c6IGZ1bmN0aW9uKGluZGV4KSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGF0LmdldFZpcnR1YWxSb3coaW5kZXgpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgZ2V0VmlydHVhbFJvd0NvdW50OiBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRoYXQudmlydHVhbFJvd0NvdW50O1xyXG4gICAgICAgIH1cclxuICAgIH07XHJcbn07XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IFZpcnR1YWxQYWdlUm93Q29udHJvbGxlcjtcclxuIl19
