angular.module('angular-meteor.reactive', ['angular-meteor.reactive-scope']).factory('$reactive', ['$rootScope', '$parse', ($rootScope, $parse) => {
  class ReactiveContext {
    constructor(context, scope) {
      if (!context || !angular.isObject(context)) {
        throw new Error('[angular-meteor][ReactiveContext] The context for ReactiveContext is required and must be an object!');
      }

      this.context = context;
      this.scope = scope;

      if (!this.scope && (this.context.constructor || angular.noop).toString().indexOf('Scope') > -1) {
        this.scope = this.context;
      }

      this.computations = [];
      this.stoppables = [];
      this.callbacks = [];
      this.trackerDeps = {};
    }

    _handleCursor(cursor, name) {
      if (angular.isUndefined(this.context[name])) {
        this.context[name] = [];
      }

      return cursor.observe({
        addedAt: (doc, atIndex) => {
          this.context[name].splice(atIndex, 0, doc);
          this._propertyChanged(name);
        },
        changedAt: (doc, oldDoc, atIndex) => {
          jsondiffpatch.patch(this.context[name][atIndex], jsondiffpatch.diff(this.context[name][atIndex], doc));
          this._propertyChanged(name);
        },
        movedTo: (doc, fromIndex, toIndex) => {
          this.context[name].splice(fromIndex, 1);
          this.context[name].splice(toIndex, 0, doc);
          this._propertyChanged(name);
        },
        removedAt: (oldDoc, atIndex) => {
          this.context[name].splice(atIndex, 1);
          this._propertyChanged(name);
        }
      });
    };

    _handleNonCursor(data, name) {
      if (angular.isUndefined(this.context[name])) {
        this.context[name] = angular.copy(data);
      }
      else {
        if ((!_.isObject(data) && !_.isArray(data)) ||
          (!_.isObject(this.context[name]) && !_.isArray(this.context[name]))) {
          this.context[name] = data;
        }
        else {
          jsondiffpatch.patch(this.context[name], jsondiffpatch.diff(this.context[name], data));
        }
      }
    }

    _isMeteorCursor(obj) {
      return obj instanceof Mongo.Collection.Cursor;
    };

    reactiveProperties(props) {
      angular.forEach(props, (initialValue, propName) => {
        let reactiveVariable = new ReactiveVar(initialValue);

        Object.defineProperty(this.context, propName, {
          get: function () {
            return reactiveVariable.get();
          },
          set: function (newValue) {
            reactiveVariable.set(newValue);
          }
        });
      });
    }

    helpers(props) {
      angular.forEach(props, (func, name) => {
        this.computations.push(Tracker.autorun((comp) => {
          if (!angular.isFunction(func)) {
            throw new Error('[angular-meteor][ReactiveContext] Helper ' + name + ' is not a function!');
          }

          let data = func();

          if (this._isMeteorCursor(data)) {
            let stoppableObservation = this._handleCursor(data, name);

            comp.onInvalidate(() => {
              stoppableObservation.stop();
              this.context[name] = [];
            });
          }
          else {
            this._handleNonCursor(data, name);
          }

          this._propertyChanged(name);
        }));
      });

      return this;
    }

    _track(property, objectEquality) {
      let scope = this.scope || $rootScope;
      let getValue = $parse(property);
      objectEquality = !!objectEquality;

      if (!this.trackerDeps[property]) {
        this.trackerDeps[property] = new Tracker.Dependency();

        scope.$watch(() => getValue(this.context),
          (newVal, oldVal) => {
            if (newVal !== oldVal) {
              this.trackerDeps[property].changed();
            }
          }, objectEquality);
      }

      this.trackerDeps[property].depend();

      return getValue(this.context);
    }

    onPropertyChanged(cb) {
      this.callbacks.push(cb);
    }

    _propertyChanged(propName) {
      if (this.scope && !$rootScope.$$phase) {
        this.scope.$digest();
      }

      angular.forEach(this.callbacks, (cb) => {
        cb(propName);
      });
    }

    subscribe(name, fn) {
      if (this.scope) {
        this.scope.subscribe(name, fn);
      }
      else {
        this.autorun(() => {
          this.stoppables.push(Meteor.subscribe(name, ...(fn() || [])));
        });
      }
    }

    autorun(fn) {
      if (this.scope) {
        this.scope.autorun(fn);
      }
      else {
        this.stoppables.push(Meteor.autorun(fn));
      }
    }

    stop() {
      angular.forEach(this.computations, (comp) => {
        comp.stop();
      });

      angular.forEach(this.stoppables, (stoppable) => {
        stoppable.stop();
      });
    }
  }

  return function (context, scope) {
    return new ReactiveContext(context, scope);
  };
}]);