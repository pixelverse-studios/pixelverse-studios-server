const { gql } = require('apollo-server')

const typeDefs = gql`
    scalar Date

    type User {
        id: ID!
        email: String!
        password: String!
        firstName: String
        lastName: String
        token: String
        passwordResetToken: String
    }

    type MeetingPrepInfo {
        answer: String
        question: String
    }

    type Meeting {
        location: String
        url: String
        scheduledFor: Date
        prepInfo: [MeetingPrepInfo]
    }

    type Finances {
        hourly: String
        totalEstimate: Float
    }

    type ClientProject {
        title: String
        domain: String
        externalDependencies: [String]
        hoursLogged: Float
        notes: String
        originalLaunchDate: Date
        updatedLaunchDate: Date
    }

    type Client {
        id: ID!
        email: String!
        firstName: String!
        lastName: String!
        status: String!
        meetings: [Meeting]
        originalCostEstimate: Float
        updatedCostEstimate: Float
        project: ClientProject
    }

    type Query {
        # USERS
        getUser(email: String!): User
        getAllUsers: [User]
        getLoggedInUser: User!

        # CLIENTS
        getAllClients: [Client]
    }

    type Mutation {
        # USERS
        register(email: String!, password: String!): User!
        login(email: String!, password: String!): User!
        updateUser(firstName: String, lastName: String, email: String!): User!
        updatePassword(email: String!, newPassword: String!): User!
        deleteUser(id: String!): [User]
        sendPasswordResetEmail(email: String!): [User]

        # CLIENTS
        addNewClient(eventUri: String!, inviteeUri: String!): Client!
    }
`

module.exports = typeDefs
