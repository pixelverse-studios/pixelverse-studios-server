const { gql } = require('apollo-server')

const typeDefs = gql`
    scalar Date

    enum UserSuccessTypes {
        registered
        loggedIn
        fetchedUser
        allUsersFetched
    }

    enum ErrorTypes {
        # FORM
        badInput

        # USER
        userNotFound
        emailInUse
        invalidToken
        noUsersFound
        invalidCredentials
        matchingPasswords

        # CLIENT
        clientNotFound
        noClientsFound

        # GENERAL
        fetched
    }

    type UserSuccess {
        _id: ID!
        email: String!
        password: String!
        firstName: String
        lastName: String
        token: String
        passwordResetToken: String
        successType: UserSuccessTypes!
    }

    type InputFieldError {
        field: String!
        message: String!
    }

    type Errors {
        type: ErrorTypes
        message: String
        errors: [InputFieldError]
    }

    union UserResponse = UserSuccess | Errors

    type MeetingPrepInfo {
        answer: String
        question: String
    }

    type Meeting {
        _id: ID
        location: String
        url: String
        scheduledFor: Date
        prepInfo: [MeetingPrepInfo]
        notes: [String]
    }

    type Finances {
        hourly: String
        totalEstimate: Float
    }

    type LoggedHoursType {
        date: Date
        hours: Float
        developer: String
    }

    type ProjectPhase {
        _id: ID
        hoursLogged: [LoggedHoursType]
        originalCostEstimate: Float
        updatedCostEstimate: Float
        originalLaunchDate: Date
        updatedLaunchDate: Date
        status: String
        notes: [String]
        amountPaid: Float
    }

    type ClientProject {
        title: String
        domain: String
        externalDependencies: [String]
        phases: [ProjectPhase]
    }

    enum ClientSuccessTypes {
        clientAdded
        clientUpdated
        allClientsFetched
        clientFetched
    }

    type ClientSuccess {
        _id: ID!
        email: String!
        firstName: String!
        lastName: String!
        meetings: [Meeting]
        project: ClientProject
        notes: [String]
        successType: ClientSuccessTypes!
    }

    union ClientResponse = ClientSuccess | Errors

    type Query {
        # USERS
        getUser(email: String!): UserResponse!
        getAllUsers: [UserResponse]
        getLoggedInUser: UserResponse!

        # CLIENTS
        getAllClients: [ClientResponse]
        getClient(email: String!): ClientResponse!
    }

    input LoggedHoursInput {
        date: Date
        hours: Float
        developer: String
    }

    input ProjectPhaseInput {
        hoursLogged: [LoggedHoursInput]
        originalCostEstimate: Float
        updatedCostEstimate: Float
        originalLaunchDate: Date
        updatedLaunchDate: Date
        status: String
        notes: [String]
        amountPaid: Float
    }

    type Mutation {
        # USERS
        register(
            email: String!
            password: String!
            firstName: String!
            lastName: String!
        ): UserResponse
        login(email: String!, password: String!): UserResponse
        updateUser(
            firstName: String
            lastName: String
            email: String!
        ): UserResponse
        updatePassword(
            email: String!
            newPassword: String!
            token: String!
        ): UserResponse
        deleteUser(id: String!): [UserResponse]
        sendPasswordResetEmail(email: String!): UserResponse

        # CLIENTS
        addNewClient(eventUri: String!, inviteeUri: String!): ClientResponse!
        editClientNotes(email: String!, notes: [String!]): ClientResponse!
        editClientMeetingNotes(
            email: String!
            notes: [String!]!
            meetingId: ID!
        ): ClientResponse!
        editClientProject(
            email: String!
            title: String
            domain: String
            externalDependencies: [String]
        ): ClientResponse!
        createClientProjectPhase(
            email: String!
            originalCostEstimate: Float!
            originalLaunchDate: Date!
            notes: [String]
        ): ClientResponse!
        editClientProjectPhase(
            email: String!
            phaseId: ID!
            updatedCostEstimate: Float
            updatedLaunchDate: Date
            status: String
            notes: [String]
            amountPaid: Float
        ): ClientResponse!
        updateProjectHoursLogged(
            email: String!
            phaseId: ID!
            date: Date!
            hours: Float!
            developer: String!
        ): ClientResponse!
    }
`

module.exports = typeDefs
