
/**
 * @doc module
 * @name docular
 * @description This module contains all the logic for the workflow of generating
 * partials and front end resources for display of docular documentation.
 *
 * Based off of Angular.js original implementation of gen-docs.js
 * Documentation code licensed under CC BY 3.0
 * http://creativecommons.org/licenses/by/3.0/
 */

/**
 * @doc function
 * @name docular.class:gen-docs
 * @requires docular.class.reader
 * @requires docular.class.writer
 * @requires docular.class.docular_utils
 * @requires node.class.qq
 * @requires node.class.q-fs
 * @requires node.class.fs
 * @requires node.class.node.extend
 * @requires node.class.colors
 * @description The gen-docs class has really only one public method "generate" which runs a mostly
 * asynchronous workflow that pulls in the docular doc apis to then parse the files and then generate
 * the HTML and partial files. It also then generates several javascript files that the UI will use
 * to access the partials.
 */


/*============ DEPENDENCIES ============*/

var reader = require('./reader.js'),
    writer = require('./writer.js'),
    doc_utils = require('./doc_utils.js'),
    SiteMap = require('./SiteMap.js').SiteMap,
    appCache = require('./appCache.js').appCache,
    Q = require('qq'),
    qfs = require('q-fs'),
    fs = require('fs'),
    path = require('path'),
    nodeExtend = require('node.extend'),
    colors = require('colors');

//default group configurations
var angularGroup = require('./defaultGroups/group_angular.js').config;
var docularGroup = require('./defaultGroups/group_docular.js').config;
var docularGroupExamples = require('./defaultGroups/group_docular_examples.js').config;


/*============ UTILITY FUNCTIONS ============*/

var now = function () { return new Date().getTime(); };
var noop = function () {};

console.section = function (message) {
    console.log("-------- " .grey + message.grey + " --------".grey);
};


/*=========== PRIVATE VARIABLES/FUNCTIONS ===========*/

//some global error handling
process.on('uncaughtException', function(err) {
    console.error(err.stack || err);
});

var addLocalGroup = function (localGroup, groups) {

    //determine the proper root location
    var rootLocation = __dirname + '/../../';

    //we need to update the URLS for the resources because they are relative to the docular package root
    for (var i=0; i < localGroup.sections.length; i++) {

        var thisSection = localGroup.sections[i];

        thisSection.scripts = thisSection.scripts || [];
        for (var j=0; j < thisSection.scripts.length; j++) {
            thisSection.scripts[j] = path.resolve(rootLocation + thisSection.scripts[j]);
        }

        thisSection.docs = thisSection.docs || [];
        for (var j=0; j < thisSection.docs.length; j++) {
            thisSection.docs[j] = path.resolve(rootLocation + thisSection.docs[j]);
        }
    }

    groups.push(localGroup);
};


/*============ PUBLIC generate function ============*/

/**
 * @doc method
 * @name docular.class:gen-docs#generate
 * @methodOf docular.class:gen-docs
 * @param {object} options_in This is the configuration which includes the groups of docs to parse
 * @param {function} callBack Function will be called when generation is complete
 * @description This is the main function to be called to kick of documentation generation.
 */

var generate = function (options_in, callBack) {

    console.log("");

    /*============ CONFIGURATION SETUP ============*/

    //this represents the basic options API
    var defaultOptions = {

        groups : [], //a list of groups which will contain paths to documentation that needs parsing

        baseUrl: '/', //where is the root for this documentation app?

        docAPIOrder: ['doc', 'angular'], //order of doc_apis CSS and JS in the UI

        showAngularDocs: false, //do you want to have angular's docs parsed and shown in the UI?

        showDocularDocs: false, //do you want to have docular's docs parsed and shown in the UI?

        analytics: {account:false, domainName:false}, //optional turn on google analytics

        discussions: {shortName:false, url:false, dev: false}, //optional turn on disqus

        docular_partial_home: false, //you can provide a url to partial to be used on the homepage, if not defined it will pull in a default

        docular_partial_group_index: false //you can provide a url to partial to be used on as the root page of a group, if not defined it will pull in a default
    };

    var options = nodeExtend(true, defaultOptions, options_in);

    var groups = options.groups || [];
    var uiOrder = options.docAPIOrder || [];

    var doc_apis_path = '/node_modules';
    var docularAPIPrefix = 'docular-doc-api-';
    var defaultDocAPI = docularAPIPrefix + 'doc';


    var baseUrl = options.baseUrl || false;

    var showAngularDocs = options.showAngularDocs || false;
    var showDocularDocs = options.showDocularDocs || false;

    if(showDocularDocs){
        addLocalGroup(docularGroup, groups);
        addLocalGroup(docularGroupExamples, groups);
    }
    if(showAngularDocs){addLocalGroup(angularGroup, groups);}


    /*============ PRIVATE METHODS / VARIABLES ============*/

    var start = now();
    var docs = [];
    var groupIds = {};
    var doc_apis = {};

    var endGenerateDocumentation = function () {
        callBack();
        return;
    };

    //setup relative paths to the current working directory
    var ABS_SCRIPTS = __dirname;
    var ABS_LIB = path.resolve(ABS_SCRIPTS + '/..');
    var ABS_BASE = path.resolve(ABS_LIB + '/..');
    var ABS_RESOURCES =  ABS_LIB + '/resources'; //need to back out one directory back to lib
    var ABS_WEBAPP = ABS_LIB + '/webapp';
    var ABS_DOC_APIS = ABS_BASE + doc_apis_path;

    var REL_SCRIPTS = path.relative(process.cwd(), ABS_SCRIPTS);
    var REL_LIB = path.relative(process.cwd(), ABS_LIB);
    var REL_BASE = path.relative(process.cwd(), ABS_BASE);
    var REL_RESOURCES = path.relative(process.cwd(), ABS_RESOURCES);
    var REL_WEBAPP = path.relative(process.cwd(), ABS_WEBAPP);
    var REL_DOC_APIS = path.relative(process.cwd(), ABS_DOC_APIS);

    var getLayoutMetaData = function () {

        var layoutMetaData = {};
        for(var doc_api in doc_apis) {
            if(doc_apis.hasOwnProperty(doc_api)){
                layoutMetaData[doc_api] = {
                    identifier: doc_apis[doc_api].identifier,
                    title: doc_apis[doc_api].title,
                    layout: doc_apis[doc_api].layout
                };
            }
        }

        return layoutMetaData;
    };

    var generateGroupManifest = function (groups) {};

    var generateSupportingFiles = function (writeFutures) {

        // We need to generate an array of page meta data for searching and partial loading in the UI
        var doc_metadata = doc_utils.metadata(docs);
        writeFutures.push(writer.output(ABS_WEBAPP + '/documentation/docs-metadata.js',
            ['DOC_DATA=', JSON.stringify(doc_metadata).replace(/\{/g, '\n{'), ';']
        ));

        // We need to generate the group information for the UI
        var group_metadata = groups;
        writeFutures.push(writer.output(ABS_WEBAPP + '/documentation/groups-metadata.js',
            ['GROUP_DATA=', JSON.stringify(group_metadata).replace(/\{/g, '\n{'), ';']
        ));

        // Lastly we should send out doc_apis information for the UI
        // This information is used by the UI to sort sections in modules and provide links to documentation
        writeFutures.push(writer.output(ABS_WEBAPP + '/documentation/layout-metadata.js',
            ['LAYOUT_DATA=', JSON.stringify(getLayoutMetaData()).replace(/\{/g, '\n{'), ';']
        ));

        // @todo run through these that were used in original ngdocs and port over the functionality
        // writeFuture.push(writer.output('sitemap.xml', new SiteMap(docs).render()));
        // writesFuture.push(writer.output('robots.txt', 'Sitemap: http://docs.angularjs.org/sitemap.xml\n'));
        // writesFuture.push(writer.output('appcache.manifest',appCache()));
        // writesFuture.push(writer.copyTemplate('.htaccess')); // will be rewritten, don't symlink
    };

    var generateConfigScript = function (writeFutures, baseUrl) {

        var configScript = "";

        //first determine if we have a baseURL to configure
        if(baseUrl){
            configScript = configScript + "baseURL = '" + baseUrl + "'; addTag('base', {href: '" + baseUrl + "'}); ";
        }

        // GA asynchronous tracker
        if(options.analytics.account && options.analytics.domainName) {
            configScript = configScript + " " +
            "var _gaq = _gaq || []; " +
            "_gaq.push(['_setAccount', '" + options.analytics.account + "']); " +
            "_gaq.push(['_setDomainName', '" + options.analytics.domainName + "']); " +
            "(function() { " +
                "var ga = document.createElement('script'); ga.type = 'text/javascript'; ga.async = true; " +
                "ga.src = ('https:' == document.location.protocol ? 'https://ssl' : 'http://www') + '.google-analytics.com/ga.js'; " +
                "var s = document.getElementsByTagName('script')[0]; s.parentNode.insertBefore(ga, s); " +
            "})(); ";
        }

        // Disqus Configurations
        var discussionsActive = (options.discussions.shortName || options.discussions.url) ? true : false;

        configScript = configScript + " " +
        "window.discussionConfigs = {active:"+
        discussionsActive + ", shortName:'" +
        options.discussions.shortName + "', url:'" +
        options.discussions.url + "', dev:" +
        options.discussions.dev + "}; ";

        writeFutures.push(writer.output(ABS_WEBAPP + '/documentation/docular-configuration.js',[configScript]));
    };

    var generateWebappPartials = function (writeFutures) {

        var partials = {
            'docular_partial_home' : options.docular_partial_home ? options.docular_partial_home : ABS_RESOURCES + '/templates/docular_partial_home.html',
            'docular_partial_group_index' : options.docular_partial_group_index ? options.docular_partial_group_index : ABS_RESOURCES + '/templates/docular_partial_group_index.html'
        };

        var getPartialPromise = function (url, partialName) {
            return Q.when(qfs.read(url, 'b'), function(content) {
                return writer.output(
                    ABS_WEBAPP + '/resources/docular-partials/'+ partialName +'.html',
                    content.toString()
                );
            })
        };

        for(var partialName in partials){
            if(partials.hasOwnProperty(partialName)){
                writeFutures.push(getPartialPromise( partials[partialName], partialName ));
            }
        }
    };


    //main logic to intialize the documentation generation for a particular documentation group
    var processGroup = function (sectionObj, groupId, doc_apis, showSource) {

        console.log('Extracting ' + groupId.cyan + ' Docs For Section "' + sectionObj.id.cyan + '"...');

        //keep track of all groupIds so we can create directories for each of them later
        groupIds[groupId] = true;

        try {

            return reader.collect(

                {
                    group: groupId,
                    section: sectionObj.id,
                    scripts: sectionObj.scripts,
                    docs: sectionObj.docs,
                    showSource: showSource
                },

                doc_apis

            ).then(function(results){

                //all docs in a section should be using the same doc_api so we only need to grab the first one
                //determine which type of doc_api was used. The UI needs this so it knows how to group docs
                //as well as provide the right copy for each section
                if(results && results[0]) {
                    sectionObj.doc_api = results[0].doc_api_extensions.apiName;
                }

                docs = docs.concat(results);
            });

        } catch (e) {
            console.log("Reader collection error:".red, e);
        }
    };


    /*============ INITIALIZATION ============*/

    //create the partials directories
    writer.makeDir(REL_WEBAPP + '/documentation/partials/', true).then(function(){

        return writer.makeDir(REL_WEBAPP + '/resources/docular-partials/', true);

    //create a directory to store any copied source files
    }).then(function(){

        return writer.makeDir(REL_WEBAPP + '/documentation/docular-source/', true);

    //Once some supporting directories are created we should get the doc_apis
    }).then(function(){

        //search for all doc_apis within the node_modules folder with prefix docular-doc-api-
        return Q.when(qfs.list(ABS_DOC_APIS), function(files){

            var rawDocAPIS = {};
            var pattern_apiFile = new RegExp(docularAPIPrefix + "([^\/]+)$",'i');

            //look for any api.js files within subdirectories of the doc_apis directory
            files.forEach(function(file) {

                var matches = pattern_apiFile.exec(doc_utils.normalizeFile(file));

                if(matches){
                    try{
                        rawDocAPIS[matches[1]] = require(file + '/index.js');
                    } catch(e) {
                        console.log("Failed to load document api:", e);
                    }
                }
            });

            //let's also nest the doc_api value inside the object
            for(var docAPI in rawDocAPIS){
                rawDocAPIS[docAPI].apiName = docAPI;
            }

            //throw an error if the default doc api was not loaded
            if(!rawDocAPIS['doc']){
                console.log("FATAL ERROR: ".red + " Error loading default doc api 'doc'.".yellow, e);
            } else {

                //first set the default doc api
                var defaultDocAPI = doc_apis['doc'] = rawDocAPIS['doc'];

                //now we use the default doc api "doc" to start as a base class
                for(var docName in rawDocAPIS) {

                    if(rawDocAPIS.hasOwnProperty(docName) && docName != 'doc') {
                        doc_apis[docName] = nodeExtend(true, {}, defaultDocAPI, rawDocAPIS[docName]);
                    }

                }
            }

        });

    //Next we need to process all the groups and normalize their api values
    }).then(function() {

        console.section("generating Docs");

        var sectionPromises = [];
        groups.forEach(function(group){

            //normalize visibility property
            group.visible = group.visible !== undefined ? group.visible : true;

            //set the default showSource value
            var showSource_default = group.showSource || false;

            group.sections.forEach(function(section){

                var showSource_section = section.showSource != undefined ? section.showSource : showSource_default;
                sectionPromises.push(processGroup(section, group.groupId, doc_apis, showSource_section));
            });
        });

        return Q.deep(sectionPromises);


    //then we need to make sure all group directories are created
    }).then(function(){

        console.section("generating partials directories for groups");

        var folderPromises = [];
        for(var groupId in groupIds) {
            folderPromises.push(writer.makeDir(REL_WEBAPP + '/documentation/partials/' + groupId, true));
        }

        //send back deep promises
        return Q.deep(folderPromises);


    }).then(function(){

        console.section("generating partials directories for sections");

        var folderPromises = [];
        groups.forEach(function(group){
            group.sections.forEach(function(section){
                folderPromises.push(writer.makeDir(REL_WEBAPP + '/documentation/partials/' + group.groupId + '/' + section.id, true));
            });
        });

        //send back deep promises
        return Q.deep(folderPromises);

    //then we have all the docs into the docs array so time to do some post processing
    }).then(function(){

        //now we merge child docs with their parentes in a nested list
        console.section("merging child Docs with parent Docs");
        try{
            doc_utils.merge(docs);
        } catch (e) {
            console.log("ERROR: ".red, "merging child docs",e);
        }

        var filePromises = [];

        //now that the children docs are nested within their parent docs, we want to write each doc to a partial file and get a promise for it
        console.section("generating partials");
        try {

            docs.forEach(function(doc){

                // this hack is here because on OSX angular.module and angular.Module map to the same file.
                var id = doc.id.replace('angular.Module', 'angular.IModule');
                doc.id = id;

                //call the doc.html() method on the doc to generate HTML to write to the partial for this particular set of documentation
                filePromises.push(writer.output(ABS_WEBAPP + '/documentation/partials/' + doc.group + '/' + doc.section + '/' + id + '.html', doc.html()));
            });

        } catch (e) {
            console.log("ERROR: ".red + " Generating partials ",e);
        }

        //add the rest of the other expected files which includes javascript objects for all the docs for the anglur docs app to use
        console.section("generating supporting files");
        generateSupportingFiles(filePromises);
        generateWebappPartials(filePromises);
        generateConfigScript(filePromises, baseUrl);

        //send back deep promises
        return Q.deep(filePromises);


    // we need to copy over all UI resources from the doc apis and generate the index.html page with the doc_api resources injected
    }).then(function() {

        //helper sort function
        var uiSort = function (a, b) {
            if(a.order > b.order) {
                return -1;
            } else if (a.order < b.order) {
                return 1;
            } else {
                return 0;
            }
        };

        //first create a helper object for ordering the order of UI resources to add
        var resourceOrder = {};
        for(var j=0; j < uiOrder.length; j++) {
            resourceOrder[uiOrder[j]] = j;
        }

        //first gather all the UI resources required for each doc_api
        var uiResourceList = [];
        var i, filePieces, sourceFileName, targetFileName;

        for(var api in doc_apis) {
            if (doc_apis.hasOwnProperty(api)){
                doc_apis[api].ui_resources = doc_apis[api].ui_resources || {css:[],js:[]};
                doc_apis[api].ui_resources.css = doc_apis[api].ui_resources.css || [];
                doc_apis[api].ui_resources.js = doc_apis[api].ui_resources.js || [];

                for(i=0; i < doc_apis[api].ui_resources.css.length; i++){
                    sourceFileName = ABS_DOC_APIS + '/' + docularAPIPrefix + api + '/' + doc_apis[api].ui_resources.css[i];
                    filePieces = sourceFileName.split('/');
                    targetFileName = filePieces[filePieces.length-1];
                    uiResourceList.push({
                        type:'css',
                        src: sourceFileName,
                        order: resourceOrder[api] || 99
                    });
                }
                for(i=0; i < doc_apis[api].ui_resources.js.length; i++){
                    sourceFileName = ABS_DOC_APIS + '/' + docularAPIPrefix + api + '/' + doc_apis[api].ui_resources.js[i];
                    filePieces = sourceFileName.split('/');
                    targetFileName = filePieces[filePieces.length-1];
                    uiResourceList.push({
                        type:'js',
                        src: sourceFileName,
                        order: resourceOrder[api] || 99
                    });
                }
            }
        }

        //the grunt config could have provided a ui resource order
        uiResourceList.sort(uiSort);

        //write the index.html file
        return Q.when(qfs.read(ABS_RESOURCES + '/templates/index.html', 'b'), function(content) {

            console.section("generating index.html page");

            return writer.output(
                ABS_WEBAPP + '/index.html',
                content.toString()
            );


        //then copy the resources from the doc_api location to the webapp
        }).then(function(){

            console.section("ordering and concatenating doc_api css and js");

            var cssContent = "";
            var jsContent = "";
            var baseURL = ABS_WEBAPP + "/";
            var copyPromises = [];

            //due to index reference problems in the for loop we create a function passback
            var copyFinished = function (resource) {
                return function (content) {
                    return {content: content.toString(), resource: resource};
                };
            };

            for(i = 0; i < uiResourceList.length; i++) {

                try{

                    fs.lstatSync(uiResourceList[i].src);
                    copyPromises.push(
                        Q.when(
                            qfs.read(uiResourceList[i].src, 'b'),
                            copyFinished(uiResourceList[i])
                        ).then(function(contentInfo){

                            if(contentInfo.resource.type === 'js') {
                                jsContent = jsContent + contentInfo.content + " ";
                            } else {
                                cssContent = cssContent + contentInfo.content + " " ;
                            }

                        })
                    );

                } catch (e) {
                    console.log("ERROR:".red + " copying ui resource", e);
                }
            }

            return Q.deep(copyPromises).then(function(){

                return writer.makeDir(REL_WEBAPP + '/resources/doc_api_resources/', true).then(function(){

                    var uiPromises = [];

                    //create the concatenated js
                    uiPromises.push(writer.output(
                        baseURL + '/resources/doc_api_resources/doc_api.js',
                        jsContent
                    ));

                    //create the concatenated js
                    uiPromises.push(writer.output(
                        baseURL + '/resources/doc_api_resources/doc_api.css',
                        cssContent
                    ));

                    return Q.deep(uiPromises);

                });

            });
        });


    }).then(function(content) {

        //generate information on the groups for the UI
        generateGroupManifest(groups);

        var totalTime = now()-start;

        //and a quick report
        console.section("generating report");
        console.log('DONE!'.green + ' Generated ' + (docs.length + '').grey + ' pages in ' + (totalTime + '').grey + ' ms. Partials per second : ' + (Math.round(docs.length/(totalTime/1000)) + '').grey);
        console.log('');

    });

};

//and the exported gen-docs api
module.exports = {
    generate: generate
};

