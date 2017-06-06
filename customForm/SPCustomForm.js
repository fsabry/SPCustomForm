function getQueryStringParam(paramName) {
  //handle a url like such as : Form.aspx?&ID=1&listGuid=BD81C2B1-0178-4A7A-A54E-42B697C51F88
  var urlParams = [],
    match,
    pl = /\+/g, //
    search = /([^&=]+)=?([^&]*)/g,
    decode = function(s) {
      return decodeURIComponent(s.replace(pl, " "));
    },
    query = window.location.search.substring(1);

  while (match = search.exec(query)) {
    urlParams[decode(match[1])] = decode(match[2]);
  }

  return urlParams[paramName];

}
(function($, document, window, undefined) {

  $.fn.formify = function(options) {
    var that = this;
    var fieldData; //REST data /Fields
    var listData; //REST data /Items
    var listDataData; //REST data about list (to get the Title)
    var listEntityName; //item __metadata > type
    var savedNames = {}; //used for holding user info re: filling user fields
    var lookupListData = {}; //data from other lookup lists
    var newFiles = {}; //we use newFiles to keep track of files attached to New items. then they can be attached after the item is created
    var modalHtml = "";
    var settings = $.extend({
      web: _spPageContextInfo.webServerRelativeUrl,
      displayArray: [], //eg ["Title","myTime","myPeeps","myDude"], //these fields are always display (so we can have a mix of edit and display); do not use Id suffix for lookups
      hiddenFields: [], //not yet functional
      lang: 1033, //1033-English;1036-French
      includeControls: true //save, save and exit, cancel, test
    }, options);

    var messages = {};

    if (settings.lang === 1036) {
      messages.delete = "Supprimer ";
      messages.cannotSave = "Le formulaire ne peut pas être sauvegardé. <br>Les champs obligatoires suivants sont vides:";
      messages.uploadFile = "Impossible de télécharger un fichier!";
    } else {
      messages.delete = "Delete ";
      messages.cannotSave = "Form cannot be saved.<br>The following required fields are empty:";
      messages.uploadFile = "Failed to upload a file!";
    }

    function getJSDateFromSPDate(spDate) {
      //2014-09-30T04:00:00Z
      var dateOnly, dateArr;

      if (spDate && spDate.indexOf("T") !== -1) {
        dateOnly = spDate.split("T")[0];
        dateArr = dateOnly.split("-");
        return new Date(dateArr[0], Number(dateArr[1] - 1), Number(dateArr[2]));
      }
      return spDate;
    }

    function getReadableDateFromJSDate(date) {
      var day, month, year;

      if (date) {

        day = String(date.getDate());
        day = '0' + day;
        day = day.slice(-2);
        month = String(date.getMonth() + 1);
        month = '0' + month;
        month = month.slice(-2);
        year = date.getFullYear();
        return month + "/" + day + "/" + year;
      }
      return date;
    }

    function getSPDateFromJSDate(thisDate) {

      var stringDate = "";
      stringDate += thisDate.getFullYear() + "-";
      stringDate += ('0' + (thisDate.getMonth() + 1)).slice(-2) + "-";
      stringDate += ('0' + thisDate.getDate()).slice(-2) + "T";
      stringDate += ('0' + thisDate.getHours()).slice(-2) + ":";
      stringDate += ('0' + thisDate.getMinutes()).slice(-2) + ":";
      stringDate += ('0' + thisDate.getSeconds()).slice(-2) + "Z";
      return stringDate;
    }

    function getJSDateFromDatepicker(dpDate) {

      var dateArr;

      if (dpDate.indexOf("/") !== -1) {

        dateArr = dpDate.split("/");
        return new Date(dateArr[2], Number(dateArr[0] - 1), Number(dateArr[1]));
      }
      return dpDate;
    }

    function getFriendlyTimeNow() {
      var now = new Date(),
        ampm = 'am',
        h = now.getHours(),
        m = now.getMinutes(),
        s = now.getSeconds();
      if (h >= 12) {
        if (h > 12) h -= 12;
        ampm = 'pm';
      }

      if (m < 10) m = '0' + m;
      if (s < 10) s = '0' + s;
      return now.toLocaleDateString() + ' ' + h + ':' + m + ':' + s + ' ' + ampm;
    }

    function restGet(restURL) {

      return $.ajax({
        url: restURL,
        type: "GET",
        dataType: "json",
        headers: {
          "Accept": "application/json;odata=verbose"
        }
      });
    }

    function restUpdate(restURL, postData) {

      return $.ajax({
        url: restURL,
        type: "POST",
        contentType: "application/json;odata=verbose",
        //update only selected fields
        data: postData,
        headers: {
          "accept": "application/json;odata=verbose",
          "X-RequestDigest": $("#__REQUESTDIGEST").val(),
          "IF-MATCH": "*",
          "X-Http-Method": "MERGE"
        }
      });
    }

    function restCreate(restURL, postData) {
      return $.ajax({
        url: restURL,
        type: "POST",
        contentType: "application/json;odata=verbose",
        data: postData,
        headers: {
          "accept": "application/json;odata=verbose",
          "X-RequestDigest": $("#__REQUESTDIGEST").val()
        }
      });
    }

    //confimation Modal
    var setModal = function setModal(msg, okClickedFunc, cancelClickedFunc, isHideCancel) {

      var m = that.find(".confirmModal");
      m.find(".confirmModalLabel").html(msg);
      m.find(".confirm, .cancel").off("click");
      m.find(".cancel").show();
      if (isHideCancel) {
        m.find(".cancel").hide();
      }
      if (okClickedFunc) {
        m.find(".confirm").on("click", okClickedFunc);
      }
      if (cancelClickedFunc) {
        m.find(".cancel").on("click", cancelClickedFunc);
      }

    };

    //send an array and fill a ppl field
    //arr - an array from the Json
    //field the internal name of the field to fill
    var setNamesInPplPicker = function(arr, field) {
      $.each(arr, function(index, item) {
        setCPP(item.Title, field + "Id", arr);
      }); //each
    };

    //delete all names in a ppl control
    var deleteNamesFromPicker = function(controlName) {

      var peoplePickerDiv = $("[id$='ClientPeoplePicker'][title='" + controlName + "']"),
        peoplePickerEditor = peoplePickerDiv.find("[title='" + controlName + "']"),
        spPeoplePicker = SPClientPeoplePicker.SPClientPeoplePickerDict[peoplePickerDiv[0].id],
        users = spPeoplePicker.GetAllUserInfo();
      users.forEach(function(index) {
        spPeoplePicker.DeleteProcessedUser(users[index]);
      });
    };

    //set a name in a ppl control
    var setCPP = function(name, controlName) {
      controlName = controlName.substring(0, controlName.length - 2);
      var peoplePickerDiv = $("[title='" + controlName + "']");
      var peoplePickerEditor = peoplePickerDiv.find(".sp-peoplepicker-topLevel").attr("id");
      var spPeoplePicker = SPClientPeoplePicker.SPClientPeoplePickerDict[peoplePickerEditor];
      spPeoplePicker.AddUserKeys(name, false);
      spPeoplePicker.AddUnresolvedUserFromEditor(true);
    };

    //recreate the html for each field
    var processFieldData = function() {
      var html,
        thisHtml,
        form;

      if (settings.htmlData) { //if html template given, then lay it down brother
        that.append(modalHtml + settings.htmlData);
        form = that.find(".myForm");
      } else { //otherwise give this default container
        html = "<div class='myContainer' data-guid='" + settings.listGuid + "' data-listMetadata='" + listEntityName + "'><table class='table table-hover'>";
      }

      $.each(fieldData, function(index, item) {
        thisHtml = "";
        var isEdit = false;
        var lookup;
        var isLookup = function(val) {

          if (val == 20 || val == 7 || val == 19) {
            return "Id";
          }
          return "";
        };
        if (settings.isEditForm && (settings.displayArray.indexOf(item.InternalName) == -1)) { //if we are editing and this is not a lookup up form (we do lookups later)
          isEdit = true;
        }

        if (settings.hiddenFields.indexOf(item.InternalName) !== -1 || (!item.Hidden && !item.ReadOnlyField && item.FieldTypeKind !== 12)) { //12  is ContentType
          //if an edit field, get the SP schema and make into radable json, then into html
          msg("isEdit "+isEdit +" "+item.InternalName);
          if (isEdit && item.SchemaXml) {
            schema = item.SchemaXml;
            schema = schema.replace(/\\/g, "");
            schema = jQuery.parseXML(schema);
            item.jsonS = xmlToJson(schema);
            thisHtml = getFieldHtml(item);
          }//otherwise
          if (settings.htmlData) { //if we have been given a template
            lookup = isLookup(item.FieldTypeKind);
            //we append 'Id' for lookup as sharepoint does
            //'first' is for the display name
            form.find(".first[data-internal-fieldname='" + item.InternalName + lookup + "']").attr("data-fieldtypekind", item.FieldTypeKind).html(item.Title + " " + (item.Required ? '<span>*</span>' : ''));
            //'second' is for the field data
            form.find(".second[data-internal-fieldname='" + item.InternalName + lookup + "']").attr("data-isedit", isEdit).html(thisHtml);
          } else { //or use this default html
            html += "<tr><td class='col-md-6 first' data-fieldTypeKind='" + item.FieldTypeKind + "' data-internal-fieldName='" + item.InternalName + "'>" + item.Title + " " + (item.Required ? '<span>*</span>' : '') +
              "</td><td class='col-md-6 second' data-internal-fieldName='" + item.InternalName + "' data-isedit='"+isEdit+"'>" + thisHtml + "</td></tr>";
          }
        }

      });//each

      //add save button, cancel button, attachments
      if (settings.includeControls) {
        var paperclipImg = settings.scriptFolder + "/paperclip.png";
        if (!settings.htmlData) {
          html += "<tr><td class='col-md-6'></td><td class='col-md-6'><button type='button' class='btn btn-default testButton'>Test</button><button type='button' class='btn btn-default saveButton'>Save</button><button type='button' class='btn btn-default saveAndExitButton'>Save and Exit</button><button type='button' class='btn btn-default cancelButton'>Cancel</button>" +
            "<div class='attachmentsContainer'><img class='paperclip' src='" + paperclipImg + "'>" +
            "<input class='myAttachments' style='display:none;' type='file' fileread='run.AttachmentData' fileinfo='run.AttachmentInfo' /><div class='attachments'></div></div>";
        } else {
          form.find(".paperclip").attr("src",paperclipImg);
        }
      }

      $(document).ready(function() {
        msg("window.location.pathname " + window.location.pathname);
        if (!settings.htmlData) { //finish off default template
          that.append(modalHtml + html + "</table></div>");
        }
        //add the title of the list
        $("#DeltaPlaceHolderPageTitleInTitleArea").find("a").eq(1).text(listDataData.Title);

        //some fields need special init; ppl, multi, lookup, date
        initFields();

        if (!settings.itemId) { //new form
          setDefaults();
        } else { //edit form
          setFields();
          getAttachments();
        }
        initEvents();//event handlers
        that.fadeIn();
      });
    };

    var getAttachments = function() {

      var html = "";
      var deleteImg = settings.scriptFolder + "/delete.png";
      if (listData.AttachmentFiles.results && listData.AttachmentFiles.results.length > 0) {
        for (var i = 0; i < listData.AttachmentFiles.results.length; i++) {
          html += "<div><a target='_blank' href='" + listData.AttachmentFiles.results[i].ServerRelativeUrl + "'>" + listData.AttachmentFiles.results[i].FileName + "</a>" +
            "<span class='deleteAttachment' style='margin-left:10px;' data-file='" + listData.AttachmentFiles.results[i].FileName + "'><img src='" + deleteImg + "'></span></div>";
        }
        that.find(".attachments").append(html);
        that.find(".attachments").on("click", ".deleteAttachment", function() {
          setModal(messages.delete + $(this).attr("data-file") + "?", function() {
            that.find(".confirmModal").modal("hide");
            deleteAttachment($(this));
          }, null, true);
          that.find(".confirmModal").modal("show");
        });
      }
    };

    //date validator. if not incorrect dates will cause a save error
    var isDate = function(date) {
      return (new Date(date) !== "Invalid Date") && !isNaN(new Date(date));
    };

    //get a save object and save
    var saveForm = function(isExit) {

      //first we need to get all the user data, so we make a bunch of rest calls, then we can create the postObj
      //if all required fields are filled we post
      //if new item, after saving, we check for uploaded files and attach those

      var singleFields = {}; //an object to hold data from single ppl fields
      var multiFields = {}; //an object to hold data from single ppl fields
      var encodedLoginArr = []; //get an array of encoded logins. these will be used to make rest calls to get the user ids for saving
      var ajaxCalls = []; //make an array of calls ; one for each user
      var nameData = []; //all the user rest data will be stored in here
      var names = that.find(".sp-peoplepicker-userSpan"); //get all the users divs
      var isEmptyRequiredField = "";//build a string to tell user they have missed req fields

      //we need to get user data for each name via rest
      names.each(function() {
        //get all user logins and store in approprate array
        var login = $(this).attr("sid");
        login = login.replace("span", "");

        var arr = login.split("\\");
        var encodedLogin = encodeURIComponent(arr[0] + "\\" + arr[1]);
        var field = $(this).closest(".customField").attr("data-internal");
        var type = $(this).closest(".customField").attr("data-kind");
        var internalName = $(this).closest(".customField").attr("data-internal");

        //gather the user logins to use as keys
        if (type === "User") {
          singleFields[internalName] = login;
        } else if (type === "UserMulti") {
          if (!multiFields[internalName]) {
            multiFields[internalName] = [login];
          } else {
            multiFields[internalName].push(login);
          }
        }
        //now make the rest urls
        if (encodedLoginArr.indexOf(encodedLogin) == -1) {
          encodedLoginArr.push(encodedLogin);
          var userUrl = settings.web + "/_api/web/siteusers?&$filter=LoginName%20eq%20%27" + encodedLogin + "%27";
          ajaxCalls.push(restGet(userUrl).done(function(data) {
            //if no data we must say that a user is not part of this web
            //dont know how to get the user if this case
            if (data.d.results[0]) {
              nameData.push(data.d.results[0]);
            }
          }));
        }
      });

      //when all the user calls are done, we have all the info we need to save
      $.when.apply($, ajaxCalls).done(function() {

        var saveObj = {
          "__metadata": {
            "type": listEntityName
          }
        };

        var fields = that.find(".customField");

        fields.each(function() {
          var type = $(this).attr("name");
          var field = $(this).attr("data-internal");
          var isRequired = $(this).attr("data-required");
          var id;
          var val = getValue($(this), type, field);
          msg(type + " " + field + " " + val);
          saveObj[field] = val;
          if (isRequired == "true" && !val) {
            isEmptyRequiredField += "- " + field + "<br>";
          }
          //here get ppl field
        });

        //we want to search the data that came back from rest about user, and return the id for the saveObj
        function getIdFromUserData(val) {

          var id = "";
          for (var i = 0; i < nameData.length; i++) {
            if (nameData[i].Title == val) {
              id = nameData[i].Id;
              break;
            }
          }
          return id;
        }

        //get a value from a certain field, (prob need to merge with user data)
        function getValue(i, type, field) {
          var obj, checked, isMultiple, val, ids, idArr, kind, resolved;
          if (type === "single") {
            return i.find("input").val();
          } else if (type === "number") {
            return parseFloat(i.find("input").val());
          } else if (type === "radioButtons") {
            return i.find("input:checked").val();
          } else if (type === "dropdown") {
            return i.find("select").val();
          } else if (type === "dateTime") {
            if (i.find("input").val()) {
              return getSPDateFromJSDate(getJSDateFromDatepicker(i.find("input").val()));
            }
              return null;
          } else if (type === "boolean") {
            return i.find("input").is(":checked");
          } else if (type === "multiText") {
            return i.find("textarea").val();
          } else if (type === "multiTextEnhanced") {
            return i.find(".DCContent").html();
          } else if (type === "checkBoxes") {
            obj = {
              "__metadata": {
                "type": "Collection(Edm.String)"
              },
              "results": []
            };
            checked = i.find("input:checked");
            checked.each(function() {
              obj.results.push($(this).val());
            });
            return obj;
          } else if (type == "lookup") {
            isMultiple = i.attr("data-allowMultipleValues");
            if (isMultiple === "true") {
              val = i.find(".multiLookup").attr("data-text");
              ids = i.find(".multiLookup").attr("data-id");
              obj = {
                "__metadata": {
                  "type": "Collection(Edm.Int32)"
                },
                "results": []
              };
              if (ids) {
                if (ids.indexOf(";") != -1) {
                  idArr = ids.split(";");
                  idArr.pop();
                  for (var j = 0; j < idArr.length; j++) idArr[j] = +idArr[j];
                  obj.results = idArr;
                  return obj;
                } else {
                  obj.results.push(Number(ids));
                  return obj;
                }
              } else {
                return obj;
              }
            } else {
              ids = Number(i.find("select").val());
              if (!ids) {
                return null;
              }
            }
            return ids;
          } else if (type == "multiTextEnhanced") {
            return i.find("[role='textbox']").html();
          } else if (type == "multiText") {
            return i.find("textarea").val();
          } else if (type == "pplPicker") {
            kind = i.attr("data-kind");
            resolved = i.find(".ms-entity-resolved");
            if (kind == "UserMulti") {
              obj = {
                "__metadata": {
                  "type": "Collection(Edm.Int32)"
                },
                "results": []
              };
              resolved.each(function() {
                id = getIdFromUserData($(this).attr("title"));
                if (id) {
                  obj.results.push(id);
                }
              });
              return obj;
            } else {
              if (resolved) {
                id = getIdFromUserData(resolved.attr("title"));
                if (id) {
                  return id;
                } else {
                  return null;
                }
              } else {
                return null;
              }
            }
          }
          return null;
        }
        //we can't save because there are empty required fields
        if (isEmptyRequiredField) {
          setModal(messages.cannotSave + isEmptyRequiredField, function() {
            that.find(".confirmModal").modal("hide");
          }, null, true);
          that.find(".confirmModal").modal("show");
        } else { //save is ok
          var postUrl = settings.web + "/_api/Web/Lists(guid'" + settings.listGuid + "')/items";
          if (settings.itemId) {
            postUrl += "(" + settings.itemId + ")";
            restUpdate(postUrl, JSON.stringify(saveObj)).done(function(data) {
                msg("updated!" + JSON.stringify(data) + " x " + isExit + " " + settings.goHereAfterSave);
                if (isExit && settings.goHereAfterSave) {
                  msg("gon updated!" + JSON.stringify(data) + " " + isExit + " " + settings.goHereAfterSave);
                  window.location = settings.goHereAfterSave;
                }
              })
              .fail(function data() {
                msg("failed to save existing item " + JSON.stringify(data));
              });
          } else {
            restCreate(postUrl, JSON.stringify(saveObj))
              .done(function(data) {
                msg("created " + JSON.stringify(data));
                settings.itemId = data.d.Id;
                //SAVE complete
                if (newFiles && Object.keys(newFiles).length > 0) {
                  for (var key in newFiles) {
                    uploadFile(newFiles[key], true);
                  }
                }//how to wait for this to exit after
              })
              .fail(function(data) {
                msg("failed to save new item " + JSON.stringify(data));
              });
          }
        }
      });
    };

    var deleteAttachment = function(el) {

      var file = el.attr("data-file");
      if (!settings.itemId) {
        el.closest("div").remove();
      } else if (file) {
        $.ajax({
            url: settings.web + "/_api/web/lists(guid'" + settings.listGuid + "')/getItemById(" + settings.itemId + ")/AttachmentFiles/getByFileName('" + file + "')",
            method: 'DELETE',
            headers: {
              'X-RequestDigest': $('#__REQUESTDIGEST').val()
            }
          })
          .done(function(data) {
            el.closest("div").remove();
          })
          .fail(function(data) {
            alert("failed to delete file " + JSON.stringify(data));
          });
      }
    };

    var uploadFile = function(file, isExit) {
      var getFileBuffer = function(file) {
        var deferred = $.Deferred();
        var reader = new FileReader();

        reader.onload = function(e) {
          deferred.resolve(e.target.result);
        };

        reader.onerror = function(e) {
          deferred.reject(e.target.error);
        };

        reader.readAsArrayBuffer(file);

        return deferred.promise();
      };

      getFileBuffer(file).then(function(buffer) {

        $.ajax({
            url: _spPageContextInfo.webAbsoluteUrl +
              "/_api/web/lists(guid'" + settings.listGuid + "')/items(" + settings.itemId + ")/AttachmentFiles/add(FileName='" + file.name + "')",
            method: 'POST',
            data: buffer,
            processData: false,
            headers: {
              "Accept": "application/json; odata=verbose",
              "content-type": "application/json; odata=verbose",
              "X-RequestDigest": document.getElementById("__REQUESTDIGEST").value,
              "content-length": buffer.byteLength
            }
          })
          .done(function(data) {
            //if this is a new item then we need to check if we are uploade all the files, then we will exit
            if (isExit) {
              newFiles[file.name].uploaded = true;
              var done = true;
              for (var key in newFiles) {
                if (!newFiles[key].uploaded) {
                  done = false;
                }
              }
              if (done) {
                msg("we are done uploading all files");
                window.location = settings.goHereAfterSave;
              }
            } else { //we are attaching and staying on the page
              var html = "<div><a target='_blank' href='#'>" + file.name + "</a>" +
                "<span class='deleteAttachment'  style='margin-left:10px;' data-file='" + file.name + "'><img src='" + _spPageContextInfo.siteAbsoluteUrl + "/style library/js/test/assets/delete.png'></span></div>";
              that.find(".attachments").append(html);
              that.find(".myAttachments").hide();
            }
          })
          .fail(function(data) {
            alert(messages.uploadFile + JSON.stringify(data));
          });

      });

    };

    var initEvents = function() {

      that.find(".paperclip").on("click", function() {
        msg("p");
        that.find(".myAttachments").toggle();
      });

      that.find(".myAttachments").on("change", function() {
        msg(".myAttachments " + settings.itemId);
        var file = $(this)[0].files[0];
        var deleteImg = settings.scriptFolder + "/delete.png";

        if (!settings.itemId) {//no where to put the file yet, so just remember the location and wil upload after item creation
          if (!newFiles[file.name]) {
            newFiles[file.name] = file;
            that.find(".attachments").append('<div class="newForm" data-name="' + file.name + '">' +
              '<a href="#">' + file.name + '</a>' +
              '<span class="deleteAttachment" data-file="' + file.name + '" style="margin-left: 10px;">' +
              '<img src="'+deleteImg+'"></span>' +
              '</div>');
          }
        } else {
          uploadFile(file);
        }
      });

      //save
      that.find(".saveButton").on("click", function() {
        saveForm();
      });
      that.find(".saveAndExitButton").on("click", function() {
        saveForm(true);
      });
      that.find(".cancelButton").on("click", function() {
        window.location = settings.goHereAfterSave;
      });
      //date validator
      that.find(".customField[name='dateTime']").find("input").on("change", function() {
        if (!isDate($(this).val())) {
          $(this).val("");
        }
      });

      //put any test function here
      that.find(".testButton").on("click", function() {
        //setUserFieldValue("myPeeps", "Mark Anderson");
      });

      //multiplookup change
      that.on("click", ".multiLookup input", function() {

        var checked = $(this).closest(".dropdown-menu").find("input:checked");
        var field = $(this).closest(".dropdown-menu").attr("data-field");
        var text = "",
          idString = "";
        checked.each(function() {
          text += $(this).attr("data-text") + ";";
          idString += $(this).attr("data-value") + ";";
        });
        $(this).closest(".dropdown-menu").attr("data-text", text).attr("data-id", idString).closest(".second").find(".textValue").text(text);
      });
    };

    //may be associated data with a lookup so get it and place in html
    var getLookUpData = function(field, lookupName, isMultiple, list) {
      var html = "";
      if (isMultiple === "false") {
        //build teh options
        if (lookupListData[list]) {
          html = "<select class='form-control input-sm' data-field='" + field + "'>";
          $.each(lookupListData[list].results, function(ind, i) {
            html += "<option data-text='" + i[field] + "' value='" + i.Id + "'>" + i[field] + "</option>";
          });
          //set the field
          that.find("[data-internal='" + lookupName + "']").html(html += "</select>");
          that.find("[data-internal='" + lookupName + "']").find("select").val(listData[lookupName]);
        }

      } else {
        if (lookupListData[list]) {
          //build the options
          html = '<div class="button-group">' +
            '<button type="button" class="btn btn-default btn-sm dropdown-toggle" data-toggle="dropdown"><span class="caret"></span></button>' +
            '<ul class="dropdown-menu multiLookup" data-field="' + lookupName + '">';

          $.each(lookupListData[list].results, function(ind, i) {
            html += '<li>' +
              '<input type="checkbox" data-text="' + i[field] + '" data-value="' + i.Id + '">&nbsp;' + i[field] + '</input>' +
              '</li>';
          });
          that.find("[data-internal='" + lookupName + "']").html(html += '</ul></div>');
          //set the field
          var val = (listData[lookupName] || {}).results;
          var str = "";
          if (val && val.length > 0) {
            for (var i = 0; i < val.length; i++) {
              that.find("[data-internal='" + lookupName + "']").find("input[data-value='" + val[i] + "']").prop("checked", true);
              str += that.find("[data-internal='" + lookupName + "']").find("input[data-value='" + val[i] + "']").attr("data-text") + ";";
            }
            that.find("[data-internal='" + lookupName + "']").closest(".second").find(".textValue").text(str);
          }
        }
      }
    };

    //call after basic html to activate complex field type
    var initFields = function() {

      that.find(".datepicker").datepicker();
      var ppl = that.find(".ppl");
      var lookups = that.find("span[name='lookup']");
      var multi = that.find("[name='multiTextEnhanced']");

      lookups.each(function(index, item) {
        var isMultiple = $(this).attr("data-allowMultipleValues");
        var field = $(this).attr("data-lookupField");
        var list = $(this).attr("data-lookupList");
        var lookupName = $(this).attr("data-internal");
        getLookUpData(field, lookupName, isMultiple, list);
      });

      if (ppl) {
        ExecuteOrDelayUntilScriptLoaded(function() {
          ppl.each(function(index, item) {
            var id = $(this).attr("id");
            var kind = $(this).closest(".customField").attr("data-kind");
            initializePeoplePicker(id, kind);
          });
        }, 'sp.js');
      }

      if (multi) {
        ExecuteOrDelayUntilScriptLoaded(function() {
          multi.each(function() {
            $(this).spHtmlEditor();
          });
        }, 'sp.js');
      }

    };

    var setFields = function() {
      //set all fields except for lookups
      //get each customFields
      //find the type
      //find the value
      //set the value
      var kind;
      var fields = that.find(".second");
      fields.each(function() {
        var isEdit = $(this).attr("data-isedit");
        var customField, type, field, val, arr, str, internalName, firstTd, fieldTypeKind;
        if (isEdit === "true") {
          customField = $(this).find(".customField");
          type = customField.attr("name");
          field = customField.attr("data-internal");
          if (type === "pplPicker") {
            field = field.substring(0, field.length - 2);
            kind = customField.attr("data-kind");
          }
          val = listData[field];
          if (val) {
            if (type === "single" || type === "number") {
              customField.find("input").val(val);
            } else if (type === "radioButtons") {
              customField.find("input[value='" + val + "']").prop("checked", true);
            } else if (type === "dropdown") {
              customField.find("select").val(val);
            } else if (type === "dateTime") {
              customField.find("input").val(getReadableDateFromJSDate(getJSDateFromSPDate(val)));
            } else if (type === "boolean") {
              customField.find("input").prop("checked", true);
            } else if (type === "checkBoxes") {
              arr = val.results;
              for (var i = 0; i < arr.length; i++) {
                customField.find("input[value='" + arr[i] + "']").prop("checked", true);
              }
            } else if (type === "pplPicker") {
              setNamesInPplPicker(val.results || [val], field);
            } else if (type === "lookup") {
              msg("lookup set elsewhere");
            } else if (type === "multiText") {
              customField.find("textarea").val(val);
            } else if (type === "multiTextEnhanced") {
              customField.find(".edit-content").html(val);
            }
          } //val
        } //if
        else { //display
          internalName = $(this).attr("data-internal-fieldName");
          firstTd = $(".first[data-internal-fieldName='" + internalName + "']");
          fieldTypeKind = Number(firstTd.attr("data-fieldTypeKind"));
          if (fieldTypeKind == 2 || fieldTypeKind == 3 || fieldTypeKind == 6) {
            $(this).html(listData[internalName]);
          } else if (fieldTypeKind == 4 && listData[internalName]) {
            $(this).html(getReadableDateFromJSDate(getJSDateFromSPDate(listData[internalName])));
          } else if (fieldTypeKind == 8) {
            if (listData[internalName]) {
              $(this).html("Yes");
            } else {
              $(this).html("No");
            }
          } else if (fieldTypeKind == 15) {
            $(this).html(listData[internalName].results);
          } else if (fieldTypeKind == 7 || fieldTypeKind == 20) {
            val = listData[internalName.substring(0, internalName.length - 2)]; //remove
            if (val) {
              if (val.results) {
                arr = val.results;
                str = "";
                for (var j = 0; j < arr.length; j++) {
                  str += arr[j].Title + "; ";
                }
              } else if (val.Title) {
                str = val.Title;
              }
              $(this).html(str);
            }
          }
        }

      });

    }; //set default fields. probably need to merge with set fields for existing items

    //set default fields. probably need to merge with set fields for existing items
    var setDefaults = function() {

      var def = $("[data-default]");

      def.each(function(index, item) {
        var val = $(this).attr("data-default");
        if (val) {
          var type = $(this).attr("name");
          if (type === "single") {
            $(this).find("input").val(val);
          } else if (type === "radioButtons") {
            $(this).find("input[value='" + val + "']").prop("checked", true);
          } else if (type === "dropdown") {
            $(this).find("select").val(val);
          } else if (type == "dateTime") {
            $(this).find("input").val(getReadableDateFromJSDate(new Date()));
          } else if (type === "boolean") {
            $(this).find("input").prop("checked", true);
          } else if (type == "checkBoxes") {
            $(this).find("input[value='" + val + "']").prop("checked", true);
          }
        }
      });
    };

    var setUserFieldValue = function(fieldName, userName) {
      var _PeoplePicker = $("div[title='" + fieldName + "']"),
        _PeoplePickerTopId = _PeoplePicker.attr('id') + "_TopSpan",
        _PeoplePickerEditer = $("input[title='" + fieldName + "']");
      _PeoplePickerEditer.val(userName);
      var _PeoplePickerOject = SPClientPeoplePicker.SPClientPeoplePickerDict[_PeoplePickerTopId];
      _PeoplePickerOject.AddUnresolvedUserFromEditor(true);
    };
    //make a ppl field work
    var initializePeoplePicker = function(peoplePickerElementId, kind) {

      // Create a schema to store picker properties, and set the properties.
      var schema = {};
      schema.PrincipalAccountType = 'User,DL,SecGroup,SPGroup';
      schema.SearchPrincipalSource = 15;
      schema.ResolvePrincipalSource = 15;
      schema.AllowMultipleValues = (kind === "User" ? false : true);
      schema.MaximumEntitySuggestions = 50;
      schema.Width = '100%';

      // Render and initialize the picker.
      // Pass the ID of the DOM element that contains the picker, an array of initial
      // PickerEntity objects to set the picker value, and a schema that defines
      // picker properties.
      this.SPClientPeoplePicker_InitStandaloneControlWrapper(peoplePickerElementId, null, schema);

    };

    //get html for any particular field
    var getFieldHtml = function(i) {

      var title = "title='" + i.Title + "'",
        h = "",
        defaultValue = i.DefaultValue || "";

      if (i.FieldTypeKind == 2) { //single
        return h += "<span class='customField' data-required='" + i.Required + "' data-kind='" + i.TypeAsString + "' data-internal='" + i.InternalName + "' data-default='" + defaultValue + "' name='single' data-Title='" + i.Title + "'><input class='form-control' type='text' " + title + "/></span>";
      } else if (i.FieldTypeKind == 3) { //mulittext
        if (i.jsonS.Field['@attributes'].RichText == "TRUE") {
          return "<span data-required='" + i.Required + "' class='customField' data-kind='" + i.TypeAsString + "' data-internal='" + i.InternalName + "' data-default='" + defaultValue + "' name='multiTextEnhanced' data-Title='" + i.Title + "'>" +
            "<div class='ms-rtestate-field ms-rtefield ms-inputBox' id='" + i.InternalName + "Multi_" + i.Id + "_$TextField_topDiv'>" +
            "<div id='" + i.InternalName + "_" + i.Id + "_$TextField_inplacerte_label' style='display: none;'>Rich text editor " + i.InternalName + "</div>" +
            "<div class='ms-rtestate-write ms-rteflags-0 ms-rtestate-field' id='" + i.InternalName + "_" + i.Id + "_$TextField_inplacerte' role='textbox' aria-haspopup='true' aria-labelledby='" + i.InternalName + "_" + i.Id + "_$TextField_inplacerte_label' style='min-height: 84px;' contenteditable='true' aria-autocomplete='both' aria-multiline='true' RteDirty='false'>" +
            "<p></p></div></span>";
        }
        return h += "<span data-required='" + i.Required + "' class='customField' data-kind='" + i.TypeAsString + "' data-internal='" + i.InternalName + "' data-default='" + defaultValue + "' name='multiText' data-Title='" + i.Title + "'><textarea class='form-control' " + title + " /></span>";
      } else if (i.FieldTypeKind == 4) { //date time
        return h += "<span data-required='" + i.Required + "' class='customField' data-kind='" + i.TypeAsString + "' data-internal='" + i.InternalName + "' data-default='" + defaultValue + "' name='dateTime' data-Title='" + i.Title + "'><input type='text' class='datepicker form-control' " + title + "></span>";
      } else if (i.FieldTypeKind == 6) { //choice
        if (i.jsonS.Field['@attributes'].Format == "RadioButtons") {
          h += "<span data-required='" + i.Required + "' class='customField' data-kind='" + i.TypeAsString + "' data-internal='" + i.InternalName + "' data-default='" + defaultValue + "' name='radioButtons' data-Title='" + i.Title + "'><div title=" + i.Title + ">";
          $.each(i.jsonS.Field.CHOICES.CHOICE, function(index, item) {

            h += "<div class='radio-inline'>" +
              "<label>" +
              "<input type='radio' name='" + i.Title + "' id='optionsRadios1' value='" + item["#text"] + "'>" + item["#text"] + "</label>" +
              "</div>";
          });
          h += "</div></span>";
        } else { //if (i.jsonS.Field['@attributes'].Format == "Dropdown") {  //made this an else to default
          h += "<span data-required='" + i.Required + "' class='customField' data-kind='" + i.TypeAsString + "' data-internal='" + i.InternalName + "' data-default='" + defaultValue + "' name='dropdown' data-Title='" + i.Title + "'><select title=" + i.Title + " class='form-control'>";
          $.each(i.jsonS.Field.CHOICES.CHOICE, function(index, item) {
            // msg("DD"+item["#text"]);
            h += "<option value='" + item["#text"] + "'>" + item["#text"] + "</option>";
          });
          h += "</select></span>";
        }
        return h;
      } else if (i.FieldTypeKind == 8) { //boolean
        return h += "<span data-required='" + i.Required + "' class='customField' data-kind='" + i.TypeAsString + "' name='boolean' data-internal='" + i.InternalName + "' data-default='" + defaultValue + "' data-Title='" + i.Title + "'><div class='checkbox'><label><input type='checkbox' " + title + "/></label></div></span>";
      } else if (i.FieldTypeKind == 9) { //number
        return h += "<span class='customField' data-required='" + i.Required + "' data-kind='" + i.TypeAsString + "' data-internal='" + i.InternalName + "' data-default='" + defaultValue + "' name='number' data-Title='" + i.Title + "'><input class='form-control' type='number' " + title + " " + getMaxMin(i.MaximumValue, i.MinimumValue) + "/></span>";
      } else if (i.FieldTypeKind == 15) { //checkbox
        h += "<span data-required='" + i.Required + "' class='customField' data-kind='" + i.TypeAsString + "' name='checkBoxes' data-internal='" + i.InternalName + "' data-default='" + defaultValue + "' data-Title='" + i.Title + "'><div title='" + i.Title + "' class='checkBoxes'>";
        $.each(i.jsonS.Field.CHOICES.CHOICE, function(index, item) {
          h += "<div class='checkbox-inline'>" +
            "<label>" +
            "<input type='checkbox' value='" + item["#text"] + "'>" + item["#text"] + "</label>" +
            "</div>";
        });
        h += "</div></span>";
        return h;
      } else if (i.FieldTypeKind == 20) { //user
        return h += "<span data-required='" + i.Required + "' class='customField' data-kind='" + i.TypeAsString + "' data-internal='" + i.InternalName + "Id'  name='pplPicker' data-Title='" + i.Title + "'><div id='" + i.Title + "' class='ppl' " + title + " /></span>";
      } else if (i.FieldTypeKind == 7) { //lookup
        var lookupList = i.LookupList;
        lookupList = lookupList.substring(1, lookupList.length - 1);
        return h += "<span data-required='" + i.Required + "' class='customField' data-kind='" + i.TypeAsString + "' data-internal='" + i.InternalName + "Id'  name='lookup' class='lookup' data-lookupList='" + lookupList + "' data-lookupField='" + i.LookupField + "' data-allowMultipleValues='" + i.AllowMultipleValues + "' data-Title='" + i.Title + "'><div id='" + i.Title + "'  /></span><span class='textValue'></span>";
      }
      return "";
    };

    var getMaxMin = function(ma, mi) {

      var max = Number(ma),
        min = Number(mi);
      if (max < 1e12 && min > -1e12) {
        return "max='" + max + "' min='" + min + "'";
      }
      return "";
    };
    //convert xml to Json
    var xmlToJson = function(xml) {

      // Create the return object
      var obj = {};

      if (xml.nodeType == 1) { // element
        // do attributes
        if (xml.attributes.length > 0) {
          obj["@attributes"] = {};
          for (var j = 0; j < xml.attributes.length; j++) {
            var attribute = xml.attributes.item(j);
            obj["@attributes"][attribute.nodeName] = attribute.nodeValue;
          }
        }
      } else if (xml.nodeType == 3) { // text
        obj = xml.nodeValue;
      }
      // do children
      if (xml.hasChildNodes()) {
        for (var i = 0; i < xml.childNodes.length; i++) {
          var item = xml.childNodes.item(i);
          var nodeName = item.nodeName;
          if (typeof(obj[nodeName]) == "undefined") {
            obj[nodeName] = xmlToJson(item);
          } else {
            if (typeof(obj[nodeName].push) == "undefined") {
              var old = obj[nodeName];
              obj[nodeName] = [];
              obj[nodeName].push(old);
            }
            obj[nodeName].push(xmlToJson(item));
          }
        }
      }
      return obj;
    };

    //admin console
    var msg = function(val) {
      if (_spPageContextInfo.userId === settings.adminId) {
        console.log(val);
      }
    };

    var msgObj = function(val) {
      if (_spPageContextInfo.userId === settings.adminId) {
        console.dir(val);
      }
    };
    //start
    var getAllData = function() {
      /*
      we gon get all data, this includes expanding all lookups, ppl fields, and getting all dependent options from lookup fields
      so first we get the fields, then look for lookups to build the list data query and queries for lookup lists
      then when all done process the data
      */
      var fieldsUrl = settings.web + "/_api/web/Lists(guid'" + settings.listGuid + "')/Fields";
      var viewUrl = settings.web + "/_api/web/Lists(guid'" + settings.listGuid + "')/Views?&$filter=DefaultView%20eq%20true";
      var listDataUrl = settings.web + "/_api/web/Lists(guid'" + settings.listGuid + "')";
      var modalUrl = settings.scriptFolder + "modal.html";
      var deferreds = [];
      var listUrl = settings.web + "/_api/web/Lists(guid'" + settings.listGuid + "')/";

      if (settings.itemId) { //not a new item
        listUrl += "items(" + settings.itemId + ")";
      }

      if (settings.htmlUrl) {//user supplied html
        deferreds.push($.get(settings.htmlUrl).done(function(data) {
            settings.htmlData = data;
          })
          .fail(function(data) {
            msg("we failed to get the html " + JSON.stringify(data));
          })
        );
      }

        deferreds.push($.get(modalUrl).done(function(data) {
            //msg("we got the html!"+data);
            modalHtml = data;
          })
          .fail(function(data) {
            msg("we failed to get the html " + JSON.stringify(data));
          })
        );

      restGet(fieldsUrl)
        .done(function(data) {
          fieldData = data.d.results;
          //we need to build a REST call for any lookups
          var select = "";
          var expand = "";
          if (settings.itemId) {
            select = "&$select=*,AttachmentFiles,";
            expand = "&$expand=AttachmentFiles,";
          }
          //now we go through and build select and expand paramaeters for the url
          $.each(fieldData, function(index, item) {

            if (!item.Hidden && !item.ReadOnlyField && (item.FieldTypeKind == 7 || item.FieldTypeKind == 20)) {

              if (settings.itemId && item.FieldTypeKind == 20) { //people look ups
                select += item.InternalName + "/Title," + item.InternalName + "/Id,";
                expand += item.InternalName + "/Id,";
              }
              if (item.FieldTypeKind == 7) { //reg lookups
                if (settings.itemId) {
                  select += item.InternalName + "/" + item.LookupField + "," + item.InternalName + "/Id,";
                  expand += item.InternalName + "/Id,";
                }

                if (settings.isEditForm) { //if edit form we need to get lookup options
                  var list = item.LookupList;
                  list = list.substring(1, list.length - 1);
                  deferreds.push($.ajax({
                    url: settings.web + "/_api/web/Lists(guid'" + list + "')/items?&$top=5000&$select=Id," + item.LookupField,
                    type: "GET",
                    listGuid: list,
                    dataType: "json",
                    headers: {
                      "Accept": "application/json;odata=verbose"
                    },
                    success: function(data) {
                      lookupListData[this.listGuid] = data.d;
                    },
                    fail: function(data) {
                      msg("fail list lookup " + this.listGuid + " " + JSON.stringify(data));
                    }
                  })); //push
                } //if settings.isEditForm

              }
            }

          });

          //remove last ',' from url params and create list url
          if (select && settings.itemId) {
            select = select.substring(0, select.length - 1);
            expand = expand.substring(0, expand.length - 1);
            listUrl += "?" + select + expand;
          }

          //finally add the list url
          //listUrl +=  "?&$select=*";
          deferreds.push(restGet(listUrl)
            .done(function(data) {
              msg("list done");
              listData = data.d;
              msgObj(listData);
              //if there is an item or not depends how we gon get listitementity name needed for saving
              if (!settings.itemId) {
                listData = data.d;
                listEntityName = listData.ListItemEntityTypeFullName;
              } else {
                listEntityName = listData.__metadata.type;
              }
            })
            .fail(function(data) {
              msg("fail fieldData");
              msgObj(data);
            }));
          deferreds.push(restGet(viewUrl)
            .done(function(data) {
              settings.goHereAfterSave = data.d.results[0].ServerRelativeUrl;
              msg("view url " + data.d.results[0].ServerRelativeUrl);
            })
            .fail(function(data) {
              msg("fail viewUlr");
              msgObj(data);
            }));
          deferreds.push(restGet(listDataUrl)
            .done(function(data) {
              listDataData = data.d;
              msg("listData");
              msgObj(data.d);
            })
            .fail(function(data) {
              msg("fail viewUlr");
              msgObj(data);
            }));
          //make all calls
          $.when.apply($, deferreds).then(function() {
            msg("deferred done lookupListData");
            msgObj(lookupListData);
            processFieldData();
          }).fail(function() {
            msg("we failed in first apply");
          });

        })
        .fail(function(data) {
          msg("fail fieldData");
          msgObj(data);
        });
    }; //get all data

    //append css and js if in settings
    var prepareDOM = function() {

      var head = $("head");
      var myScript = $("#getCustomForm").attr("src");
      var base = myScript.split("getCustomForm")[0];
      var everythingLoaded;
      if (settings.cssUrl)
        head.append('<link rel="stylesheet" href="' + settings.cssUrl + '" type="text/css" />');

      if (settings.jsUrl)
        head.append('<script src="' + settings.jsUrl + '"/></script>');

      everythingLoaded = setInterval(function() {

        if (/loaded|complete/.test(document.readyState)) {
          clearInterval(everythingLoaded);
          getAllData(); // this is the function that gets called when everything is loaded
        }
      }, 10);
    };
    if (settings.scriptFolder && settings.listGuid){
    prepareDOM();
    }
    else{
      alert("You need to supply the script folder and a list guid");
    }
  }; //plugin

}(jQuery, document, window));
