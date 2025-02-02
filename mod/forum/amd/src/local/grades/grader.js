// This file is part of Moodle - http://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <http://www.gnu.org/licenses/>.

/**
 * This module will tie together all of the different calls the gradable module will make.
 *
 * @module     mod_forum/local/grades/grader
 * @package    mod_forum
 * @copyright  2019 Mathew May <mathew.solutions>
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
import Templates from 'core/templates';
import Selectors from './local/grader/selectors';
import getUserPicker from './local/grader/user_picker';
import {createLayout as createFullScreenWindow} from 'mod_forum/local/layout/fullscreen';
import getGradingPanelFunctions from './local/grader/gradingpanel';
import {add as addToast} from 'core/toast';
import {get_string as getString} from 'core/str';
import {failedUpdate} from 'core_grades/grades/grader/gradingpanel/normalise';
import {addIconToContainerWithPromise} from 'core/loadingicon';
import {debounce} from 'core/utils';

const templateNames = {
    grader: {
        app: 'mod_forum/local/grades/grader',
        gradingPanel: {
            error: 'mod_forum/local/grades/local/grader/gradingpanel/error',
        },
        searchResults: 'mod_forum/local/grades/local/grader/user_picker/user_search',
        status: 'mod_forum/local/grades/local/grader/status',
    },
};

/**
 * Helper function that replaces the user picker placeholder with what we get back from the user picker class.
 *
 * @param {HTMLElement} root
 * @param {String} html
 */
const displayUserPicker = (root, html) => {
    const pickerRegion = root.querySelector(Selectors.regions.pickerRegion);
    Templates.replaceNodeContents(pickerRegion, html, '');
};

/**
 * To be removed, this is now done as a part of Templates.renderForPromise()
 *
 * @param {String} html
 * @param {String} js
 * @return {[*, *]}
 */
const fetchContentFromRender = (html, js) => {
    return [html, js];
};

/**
 * Here we build the function that is passed to the user picker that'll handle updating the user content area
 * of the grading interface.
 *
 * @param {HTMLElement} root
 * @param {Function} getContentForUser
 * @param {Function} getGradeForUser
 * @return {Function}
 */
const getUpdateUserContentFunction = (root, getContentForUser, getGradeForUser) => {
    let firstLoad = true;

    return async(user) => {
        const spinner = firstLoad ? null : addIconToContainerWithPromise(root);
        const [
            [html, js],
            userGrade,
        ] = await Promise.all([
            getContentForUser(user.id).then(fetchContentFromRender),
            getGradeForUser(user.id),
        ]);
        Templates.replaceNodeContents(root.querySelector(Selectors.regions.moduleReplace), html, js);

        const [
            gradingPanelHtml,
            gradingPanelJS
        ] = await Templates.render(userGrade.templatename, userGrade.grade).then(fetchContentFromRender);
        const panelContainer = root.querySelector(Selectors.regions.gradingPanelContainer);
        const panel = panelContainer.querySelector(Selectors.regions.gradingPanel);
        Templates.replaceNodeContents(panel, gradingPanelHtml, gradingPanelJS);
        panelContainer.scrollTop = 0;
        firstLoad = false;

        if (spinner) {
            spinner.resolve();
        }
    };
};

/**
 * Show the search results container and hide the user picker and body content.
 *
 * @param {HTMLElement} bodyContainer The container element for the body content
 * @param {HTMLElement} userPickerContainer The container element for the user picker
 * @param {HTMLElement} searchResultsContainer The container element for the search results
 */
const showSearchResultContainer = (bodyContainer, userPickerContainer, searchResultsContainer) => {
    bodyContainer.classList.add('hidden');
    userPickerContainer.classList.add('hidden');
    searchResultsContainer.classList.remove('hidden');
};

/**
 * Hide the search results container and show the user picker and body content.
 *
 * @param {HTMLElement} bodyContainer The container element for the body content
 * @param {HTMLElement} userPickerContainer The container element for the user picker
 * @param {HTMLElement} searchResultsContainer The container element for the search results
 */
const hideSearchResultContainer = (bodyContainer, userPickerContainer, searchResultsContainer) => {
    bodyContainer.classList.remove('hidden');
    userPickerContainer.classList.remove('hidden');
    searchResultsContainer.classList.add('hidden');
};

/**
 * Toggles the visibility of the user search.
 *
 * @param {HTMLElement} toggleSearchButton The button that toggles the search
 * @param {HTMLElement} searchContainer The container element for the user search
 * @param {HTMLElement} searchInput The input element for searching
 */
const showUserSearchInput = (toggleSearchButton, searchContainer, searchInput) => {
    searchContainer.classList.remove('collapsed');
    toggleSearchButton.setAttribute('aria-expanded', 'true');
    toggleSearchButton.classList.add('expand');
    toggleSearchButton.classList.remove('collapse');
    searchInput.focus();
};

/**
 * Toggles the visibility of the user search.
 *
 * @param {HTMLElement} toggleSearchButton The button that toggles the search
 * @param {HTMLElement} searchContainer The container element for the user search
 * @param {HTMLElement} searchInput The input element for searching
 */
const hideUserSearchInput = (toggleSearchButton, searchContainer, searchInput) => {
    searchContainer.classList.add('collapsed');
    toggleSearchButton.setAttribute('aria-expanded', 'false');
    toggleSearchButton.classList.add('collapse');
    toggleSearchButton.classList.remove('expand');
    toggleSearchButton.focus();
    searchInput.value = '';
};

/**
 * Find the list of users who's names include the given search term.
 *
 * @param {Array} userList List of users for the grader
 * @param {String} searchTerm The search term to match
 * @return {Array}
 */
const searchForUsers = (userList, searchTerm) => {
    if (searchTerm === '') {
        return userList;
    }

    searchTerm = searchTerm.toLowerCase();

    return userList.filter((user) => {
        return user.fullname.toLowerCase().includes(searchTerm);
    });
};

/**
 * Render the list of users in the search results area.
 *
 * @param {HTMLElement} searchResultsContainer The container element for search results
 * @param {Array} users The list of users to display
 */
const renderSearchResults = async (searchResultsContainer, users) => {
    const {html, js} = await Templates.renderForPromise(templateNames.grader.searchResults, {users});
    Templates.replaceNodeContents(searchResultsContainer, html, js);
};

/**
 * Add click handlers to the buttons in the header of the grading interface.
 *
 * @param {HTMLElement} graderLayout
 * @param {Object} userPicker
 * @param {Function} saveGradeFunction
 * @param {Array} userList List of users for the grader.
 */
const registerEventListeners = (graderLayout, userPicker, saveGradeFunction, userList) => {
    const graderContainer = graderLayout.getContainer();
    const toggleSearchButton = graderContainer.querySelector(Selectors.buttons.toggleSearch);
    const searchInputContainer = graderContainer.querySelector(Selectors.regions.userSearchContainer);
    const searchInput = searchInputContainer.querySelector(Selectors.regions.userSearchInput);
    const bodyContainer = graderContainer.querySelector(Selectors.regions.bodyContainer);
    const userPickerContainer = graderContainer.querySelector(Selectors.regions.pickerRegion);
    const searchResultsContainer = graderContainer.querySelector(Selectors.regions.searchResultsContainer);

    graderContainer.addEventListener('click', (e) => {
        if (e.target.closest(Selectors.buttons.toggleFullscreen)) {
            e.stopImmediatePropagation();
            e.preventDefault();
            graderLayout.toggleFullscreen();

            return;
        }

        if (e.target.closest(Selectors.buttons.closeGrader)) {
            e.stopImmediatePropagation();
            e.preventDefault();

            graderLayout.close();

            return;
        }

        if (e.target.closest(Selectors.buttons.saveGrade)) {
            saveGradeFunction(userPicker.currentUser);
        }

        if (e.target.closest(Selectors.buttons.toggleSearch)) {
            if (toggleSearchButton.getAttribute('aria-expanded') === 'true') {
                // Search is open so let's close it.
                hideUserSearchInput(toggleSearchButton, searchInputContainer, searchInput);
                hideSearchResultContainer(bodyContainer, userPickerContainer, searchResultsContainer);
                searchResultsContainer.innerHTML = '';
            } else {
                // Search is closed so let's open it.
                showUserSearchInput(toggleSearchButton, searchInputContainer, searchInput);
                showSearchResultContainer(bodyContainer, userPickerContainer, searchResultsContainer);
                renderSearchResults(searchResultsContainer, userList);
            }

            return;
        }

        const selectUserButton = e.target.closest(Selectors.buttons.selectUser);
        if (selectUserButton) {
            const userId = selectUserButton.getAttribute('data-userid');
            const user = userList.find(user => user.id == userId);
            userPicker.setUserId(userId);
            userPicker.showUser(user);
            hideUserSearchInput(toggleSearchButton, searchInputContainer, searchInput);
            hideSearchResultContainer(bodyContainer, userPickerContainer, searchResultsContainer);
            searchResultsContainer.innerHTML = '';
        }
    });

    // Debounce the search input so that it only executes 300 milliseconds after the user has finished typing.
    searchInput.addEventListener('input', debounce(() => {
        const users = searchForUsers(userList, searchInput.value);
        renderSearchResults(searchResultsContainer, users);
    }, 300));
};

/**
 * Get the function used to save a user grade.
 *
 * @param {HTMLElement} root The container for the grader
 * @param {Function} setGradeForUser The function that will be called.
 * @return {Function}
 */
const getSaveUserGradeFunction = (root, setGradeForUser) => {
    return async(user) => {
        try {
            root.querySelector(Selectors.regions.gradingPanelErrors).innerHTML = '';
            const result = await setGradeForUser(user.id, root.querySelector(Selectors.regions.gradingPanel));
            if (result.success) {
                addToast(await getString('grades:gradesavedfor', 'mod_forum', user));
            }
            if (result.failed) {
                displayGradingError(root, user, result.error);
            }

            return result;
        } catch (err) {
            displayGradingError(root, user, err);

            return failedUpdate(err);
        }
    };
};

/**
 * Display a grading error, typically from a failed save.
 *
 * @param {HTMLElement} root The container for the grader
 * @param {Object} user The user who was errored
 * @param {Object} err The details of the error
 */
const displayGradingError = async(root, user, err) => {
    const [
        {html, js},
        errorString
    ] = await Promise.all([
        Templates.renderForPromise(templateNames.grader.gradingPanel.error, {error: err}),
        await getString('grades:gradesavefailed', 'mod_forum', {error: err.message, ...user}),
    ]);

    Templates.replaceNodeContents(root.querySelector(Selectors.regions.gradingPanelErrors), html, js);
    addToast(errorString);
};

/**
 * Launch the grader interface with the specified parameters.
 *
 * @param {Function} getListOfUsers A function to get the list of users
 * @param {Function} getContentForUser A function to get the content for a specific user
 * @param {Function} getGradeForUser A function get the grade details for a specific user
 * @param {Function} setGradeForUser A function to set the grade for a specific user
 */
export const launch = async(getListOfUsers, getContentForUser, getGradeForUser, setGradeForUser, {
    initialUserId = null, moduleName, courseName, courseUrl
} = {}) => {

    // We need all of these functions to be executed in series, if one step runs before another the interface
    // will not work.
    const [
        graderLayout,
        {html, js},
        userList,
    ] = await Promise.all([
        createFullScreenWindow({fullscreen: false, showLoader: false}),
        Templates.renderForPromise(templateNames.grader.app, {
            moduleName,
            courseName,
            courseUrl,
            drawer: {show: true}
        }),
        getListOfUsers(),
    ]);
    const graderContainer = graderLayout.getContainer();

    const saveGradeFunction = getSaveUserGradeFunction(graderContainer, setGradeForUser);

    Templates.replaceNodeContents(graderContainer, html, js);
    const updateUserContent = getUpdateUserContentFunction(graderContainer, getContentForUser, getGradeForUser);

    const userIds = userList.map(user => user.id);
    const statusContainer = graderContainer.querySelector(Selectors.regions.statusContainer);
    // Fetch the userpicker for display.
    const userPicker = await getUserPicker(
        userList,
        user => {
            const renderContext = {
                status: null,
                index: userIds.indexOf(user.id) + 1,
                total: userList.length
            };
            Templates.render(templateNames.grader.status, renderContext).then(html => {
                statusContainer.innerHTML = html;
                return html;
            }).catch();
            updateUserContent(user);
        },
        saveGradeFunction,
        {
            initialUserId,
        },
    );

    // Register all event listeners.
    registerEventListeners(graderLayout, userPicker, saveGradeFunction, userList);

    // Display the newly created user picker.
    displayUserPicker(graderContainer, userPicker.rootNode);
};

export {getGradingPanelFunctions};
